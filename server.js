import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createDAVClient } from 'tsdav'
import querystring from 'querystring'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Spotify configuration
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'

// In-memory token storage (in production, use a proper session store)
const spotifyTokens = new Map()

// Singleton DAV client
let davClient = null
let clientInitializing = false

async function getDAVClient() {
	if (clientInitializing) {
		// Wait for initialization to complete
		while (clientInitializing) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		return davClient
	}

	if (davClient) {
		return davClient
	}

	const username = process.env.ICLOUD_USERNAME || process.env.VITE_ICLOUD_USERNAME
	const password =
		process.env.ICLOUD_APP_SPECIFIC_PASSWORD || process.env.VITE_ICLOUD_APP_SPECIFIC_PASSWORD

	if (!username || !password) {
		throw new Error(
			'iCloud credentials not found. Please set ICLOUD_USERNAME and ICLOUD_APP_SPECIFIC_PASSWORD in your .env file.'
		)
	}

	clientInitializing = true

	try {
		davClient = await createDAVClient({
			serverUrl: 'https://caldav.icloud.com',
			credentials: {
				username,
				password,
			},
			authMethod: 'Basic',
			defaultAccountType: 'caldav',
		})
		return davClient
	} finally {
		clientInitializing = false
	}
}

// Health check endpoint
app.get('/api/health', (req, res) => {
	res.json({ status: 'ok' })
})

// Fetch calendars endpoint
app.post('/api/icloud/calendars', async (req, res) => {
	try {
		const client = await getDAVClient()
		const calendars = await client.fetchCalendars()
		res.json({ calendars })
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to fetch calendars',
		})
	}
})

// Fetch calendar objects endpoint
app.post('/api/icloud/calendar-objects', async (req, res) => {
	try {
		const { calendar } = req.body

		if (!calendar || !calendar.url) {
			return res.status(400).json({
				error: 'Calendar object with url is required',
			})
		}

		const client = await getDAVClient()
		const calendarObjects = await client.fetchCalendarObjects({
			calendar,
		})

		res.json({ calendarObjects })
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to fetch calendar objects',
		})
	}
})

// Spotify authentication endpoints

// Generate random string for state parameter
function generateRandomString(length) {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	let text = ''
	for (let i = 0; i < length; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return text
}

// Initiate Spotify login - returns authorization URL
app.post('/api/spotify/login', (req, res) => {
	try {
		if (!SPOTIFY_CLIENT_ID) {
			return res.status(500).json({
				error: 'Spotify Client ID not configured',
			})
		}

		const state = generateRandomString(16)
		const scope =
			'user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-playback-position user-read-private user-read-recently-played'

		// Store state for verification (in production, use proper session storage)
		spotifyTokens.set(`state_${state}`, { state, timestamp: Date.now() })

		const authUrl =
			SPOTIFY_AUTH_URL +
			'?' +
			querystring.stringify({
				response_type: 'code',
				client_id: SPOTIFY_CLIENT_ID,
				scope: scope,
				redirect_uri: SPOTIFY_REDIRECT_URI,
				state: state,
			})

		res.json({ authUrl })
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to generate auth URL',
		})
	}
})

// Handle Spotify callback - exchange code for token
app.post('/api/spotify/callback', async (req, res) => {
	try {
		const { code, state } = req.body

		if (!code) {
			return res.status(400).json({
				error: 'Authorization code is required',
			})
		}

		if (!state) {
			return res.status(400).json({
				error: 'State parameter is required',
			})
		}

		// Verify state (in production, use proper session storage)
		const storedState = spotifyTokens.get(`state_${state}`)
		if (!storedState || storedState.state !== state) {
			return res.status(400).json({
				error: 'State mismatch',
			})
		}

		// Clean up state
		spotifyTokens.delete(`state_${state}`)

		if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
			return res.status(500).json({
				error: 'Spotify credentials not configured',
			})
		}

		// Exchange code for token
		const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${Buffer.from(
					`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
				).toString('base64')}`,
			},
			body: querystring.stringify({
				grant_type: 'authorization_code',
				code: code,
				redirect_uri: SPOTIFY_REDIRECT_URI,
			}),
		})

		if (!tokenResponse.ok) {
			const errorData = await tokenResponse.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(tokenResponse.status).json({
				error: errorData.error || 'Failed to exchange code for token',
			})
		}

		const tokenData = await tokenResponse.json()

		// Store token (in production, use proper session storage with user ID)
		spotifyTokens.set('current_token', {
			...tokenData,
			expires_at: Date.now() + tokenData.expires_in * 1000,
		})

		res.json({ token: tokenData })
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to exchange code for token',
		})
	}
})

// Get current token
app.get('/api/spotify/token', (req, res) => {
	try {
		const storedToken = spotifyTokens.get('current_token')

		if (!storedToken) {
			return res.status(404).json({
				error: 'No token found',
			})
		}

		// Check if token is expired
		if (Date.now() >= storedToken.expires_at) {
			spotifyTokens.delete('current_token')
			return res.status(401).json({
				error: 'Token expired',
			})
		}

		res.json({ token: storedToken })
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to get token',
		})
	}
})

// Refresh access token
app.post('/api/spotify/refresh', async (req, res) => {
	try {
		const { refresh_token } = req.body

		if (!refresh_token) {
			return res.status(400).json({
				error: 'Refresh token is required',
			})
		}

		if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
			return res.status(500).json({
				error: 'Spotify credentials not configured',
			})
		}

		// Refresh token with Spotify
		const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${Buffer.from(
					`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
				).toString('base64')}`,
			},
			body: querystring.stringify({
				grant_type: 'refresh_token',
				refresh_token: refresh_token,
			}),
		})

		if (!tokenResponse.ok) {
			const errorData = await tokenResponse.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(tokenResponse.status).json({
				error: errorData.error || 'Failed to refresh token',
			})
		}

		const tokenData = await tokenResponse.json()

		// Update stored token
		const storedToken = spotifyTokens.get('current_token')
		const updatedToken = {
			...tokenData,
			refresh_token: tokenData.refresh_token || storedToken?.refresh_token,
			expires_at: Date.now() + tokenData.expires_in * 1000,
		}

		spotifyTokens.set('current_token', updatedToken)

		res.json({ token: updatedToken })
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to refresh token',
		})
	}
})

// Get playback state
app.get('/api/spotify/playback-state', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)

		const response = await fetch('https://api.spotify.com/v1/me/player', {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (response.status === 204) {
			// No content - no active playback
			return res.status(204).send()
		}

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Failed to get playback state',
			})
		}

		const data = await response.json()
		res.json(data)
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to get playback state',
		})
	}
})

// Get available devices
app.get('/api/spotify/devices', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)

		const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Failed to get available devices',
			})
		}

		const data = await response.json()
		res.json(data)
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to get available devices',
		})
	}
})

// Transfer playback to a device
app.put('/api/spotify/transfer-playback', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)
		const { device_ids, play } = req.body

		if (!device_ids || !Array.isArray(device_ids) || device_ids.length === 0) {
			return res.status(400).json({
				error: 'device_ids array is required',
			})
		}

		const response = await fetch('https://api.spotify.com/v1/me/player', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({ device_ids, play: play !== undefined ? play : false }),
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Failed to transfer playback',
			})
		}

		// 204 No Content is a success response
		res.status(204).send()
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to transfer playback',
		})
	}
})

// Get recently played tracks
app.get('/api/spotify/recently-played', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)
		const limit = req.query.limit || 1

		const response = await fetch(
			`https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			}
		)

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Failed to get recently played',
			})
		}

		const data = await response.json()
		res.json(data)
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to get recently played',
		})
	}
})

// Start/resume playback
app.put('/api/spotify/start-playback', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)
		const { context_uri, position_ms } = req.body

		const body = {}
		if (context_uri) {
			body.context_uri = context_uri
		}
		if (position_ms !== undefined) {
			body.position_ms = position_ms
		}

		const response = await fetch('https://api.spotify.com/v1/me/player/play', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Failed to start playback',
			})
		}

		// 204 No Content is a success response
		res.status(204).send()
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to start playback',
		})
	}
})

// Pause playback
app.put('/api/spotify/pause-playback', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)

		const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Failed to pause playback',
			})
		}

		// 204 No Content is a success response
		res.status(204).send()
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to pause playback',
		})
	}
})

// Skip to next track
app.post('/api/spotify/skip-next', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)

		const response = await fetch('https://api.spotify.com/v1/me/player/next', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Failed to skip to next',
			})
		}

		// 204 No Content is a success response
		res.status(204).send()
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to skip to next',
		})
	}
})

// Skip to previous track
app.post('/api/spotify/skip-previous', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)

		const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Failed to skip to previous',
			})
		}

		// 204 No Content is a success response
		res.status(204).send()
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to skip to previous',
		})
	}
})

// Proxy endpoint for fetching context info (playlists, albums, etc.)
app.post('/api/spotify/proxy', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)
		const { url, method = 'GET', body } = req.body

		if (!url) {
			return res.status(400).json({
				error: 'URL is required',
			})
		}

		const fetchOptions = {
			method: method,
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
		}

		if (body && method !== 'GET') {
			fetchOptions.body = JSON.stringify(body)
		}

		const response = await fetch(url, fetchOptions)

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Request failed',
			})
		}

		const data = await response.json()
		res.json(data)
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Proxy request failed',
		})
	}
})

// Get current user's profile
app.get('/api/spotify/user-profile', async (req, res) => {
	try {
		const authHeader = req.headers.authorization

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return res.status(401).json({
				error: 'Authorization header with Bearer token is required',
			})
		}

		const accessToken = authHeader.substring(7)

		const response = await fetch('https://api.spotify.com/v1/me', {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			return res.status(response.status).json({
				error: errorData.error || 'Failed to get user profile',
			})
		}

		const data = await response.json()
		res.json(data)
	} catch (error) {
		res.status(500).json({
			error: error instanceof Error ? error.message : 'Failed to get user profile',
		})
	}
})

app.listen(PORT, () => {
	console.log(`Backend server running on http://localhost:${PORT}`)
})
