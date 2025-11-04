const API_BASE_URL = import.meta.env.VITE_API_URL
const STORAGE_KEY = 'spotify_tokens'

export interface SpotifyToken {
	access_token: string
	token_type: string
	scope: string
	expires_in: number
	refresh_token: string
}

export interface SpotifyPlaybackState {
	device: {
		id: string | null
		is_active: boolean
		is_private_session: boolean
		is_restricted: boolean
		name: string
		type: string
		volume_percent: number
		supports_volume: boolean
	}
	repeat_state: string
	shuffle_state: boolean
	context: {
		type: string
		href: string
		external_urls: {
			spotify: string
		}
		uri: string
	} | null
	timestamp: number
	progress_ms: number
	is_playing: boolean
	item: Record<string, unknown> | null
	currently_playing_type: string
	actions: {
		interrupting_playback: boolean
		pausing: boolean
		resuming: boolean
		seeking: boolean
		skipping_next: boolean
		skipping_prev: boolean
		toggling_repeat_context: boolean
		toggling_shuffle: boolean
		toggling_repeat_track: boolean
		transferring_playback: boolean
	}
}

export interface SpotifyDevice {
	id: string | null
	is_active: boolean
	is_private_session: boolean
	is_restricted: boolean
	name: string
	type: string
	volume_percent: number
}

export interface TrackInfo {
	name: string
	artists: string[]
	album: string
	albumCover: string
	duration: number
}

export interface ContextInfo {
	type: 'playlist' | 'album' | 'artist' | 'show' | null
	name: string
	image: string | null
	uri: string | null
}

export interface PlaybackStateInfo {
	isPlaying: boolean
	hasActivePlayback: boolean
	activeDeviceName: string | null
	trackInfo: TrackInfo | null
	progress: number
	contextUri: string | null
	contextInfo: ContextInfo | null
}

class SpotifyService {
	private accessToken: string | null = null
	private refreshToken: string | null = null
	private tokenExpiresAt: number | null = null

	constructor() {
		// Load tokens from localStorage on initialization
		this.loadTokensFromStorage()
	}

	/**
	 * Get the authorization URL to redirect user to Spotify login
	 */
	async initiateLogin(): Promise<string> {
		const response = await fetch(`${API_BASE_URL}/api/spotify/login`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
		}

		const data = await response.json()
		return data.authUrl
	}

	/**
	 * Load tokens from localStorage
	 */
	private loadTokensFromStorage(): void {
		try {
			const stored = localStorage.getItem(STORAGE_KEY)
			if (stored) {
				const tokens = JSON.parse(stored)
				this.accessToken = tokens.accessToken
				this.refreshToken = tokens.refreshToken
				this.tokenExpiresAt = tokens.tokenExpiresAt

				// Check if token is expired
				if (this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt) {
					// Token expired, clear it
					this.clearTokens()
				}
			}
		} catch {
			this.clearTokens()
		}
	}

	/**
	 * Save tokens to localStorage
	 */
	private saveTokensToStorage(): void {
		try {
			const tokens = {
				accessToken: this.accessToken,
				refreshToken: this.refreshToken,
				tokenExpiresAt: this.tokenExpiresAt,
			}
			localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
		} catch {
			// Silent error handling
		}
	}

	/**
	 * Clear tokens from memory and storage
	 */
	private clearTokens(): void {
		this.accessToken = null
		this.refreshToken = null
		this.tokenExpiresAt = null
		localStorage.removeItem(STORAGE_KEY)
	}

	/**
	 * Exchange authorization code for access token
	 */
	async exchangeCodeForToken(code: string, state: string): Promise<SpotifyToken> {
		const response = await fetch(`${API_BASE_URL}/api/spotify/callback`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ code, state }),
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
		}

		const data = await response.json()
		const token: SpotifyToken = data.token

		// Store tokens locally and in storage
		this.accessToken = token.access_token
		this.refreshToken = token.refresh_token
		this.tokenExpiresAt = Date.now() + token.expires_in * 1000
		this.saveTokensToStorage()

		return token
	}

	/**
	 * Get current access token, refreshing if needed
	 */
	async getAccessToken(): Promise<string | null> {
		// Load tokens from storage if not in memory
		if (!this.accessToken || !this.tokenExpiresAt) {
			this.loadTokensFromStorage()
		}

		// Check if token is expired or about to expire (within 60 seconds)
		if (this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt - 60000) {
			if (this.refreshToken) {
				try {
					await this.refreshAccessToken()
				} catch {
					this.clearTokens()
					return null
				}
			} else {
				// Try to get token from server
				await this.getTokenFromServer()
			}
		}

		return this.accessToken
	}

	/**
	 * Refresh the access token using refresh token
	 */
	async refreshAccessToken(): Promise<void> {
		if (!this.refreshToken) {
			throw new Error('No refresh token available')
		}

		const response = await fetch(`${API_BASE_URL}/api/spotify/refresh`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ refresh_token: this.refreshToken }),
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
		}

		const data = await response.json()
		const token: SpotifyToken = data.token

		this.accessToken = token.access_token
		if (token.refresh_token) {
			this.refreshToken = token.refresh_token
		}
		this.tokenExpiresAt = Date.now() + token.expires_in * 1000
		this.saveTokensToStorage()
	}

	/**
	 * Get token from server (if stored server-side)
	 */
	private async getTokenFromServer(): Promise<void> {
		const response = await fetch(`${API_BASE_URL}/api/spotify/token`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
			},
		})

		if (response.ok) {
			const data = await response.json()
			if (data.token) {
				const token: SpotifyToken = data.token
				this.accessToken = token.access_token
				this.refreshToken = token.refresh_token
				this.tokenExpiresAt = Date.now() + token.expires_in * 1000
				this.saveTokensToStorage()
			}
		}
	}

	/**
	 * Check if user is authenticated
	 */
	isAuthenticated(): boolean {
		return (
			this.accessToken !== null &&
			this.tokenExpiresAt !== null &&
			Date.now() < this.tokenExpiresAt
		)
	}

	/**
	 * Clear stored tokens (logout)
	 */
	logout(): void {
		this.clearTokens()
	}

	/**
	 * Get current playback state
	 */
	async getPlaybackState(): Promise<SpotifyPlaybackState | null> {
		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return null
		}

		try {
			const response = await fetch(`${API_BASE_URL}/api/spotify/playback-state`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			})

			// Handle 204 No Content (no active playback)
			if (response.status === 204) {
				return null
			}

			if (!response.ok) {
				const errorText = await response.text()
				let errorData
				try {
					errorData = JSON.parse(errorText)
				} catch {
					errorData = { error: errorText || 'Unknown error' }
				}
				throw new Error(
					errorData.error?.message ||
						errorData.error ||
						`HTTP error! status: ${response.status}`
				)
			}

			// Check if response has content before parsing
			const contentType = response.headers.get('content-type')
			if (!contentType || !contentType.includes('application/json')) {
				return null
			}

			const text = await response.text()
			if (!text || text.trim() === '') {
				return null
			}

			const data = JSON.parse(text)
			return data
		} catch {
			return null
		}
	}

	/**
	 * Get available devices
	 */
	async getAvailableDevices(): Promise<SpotifyDevice[]> {
		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return []
		}

		try {
			const response = await fetch(`${API_BASE_URL}/api/spotify/devices`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			})

			if (!response.ok) {
				const errorText = await response.text()
				let errorData
				try {
					errorData = JSON.parse(errorText)
				} catch {
					errorData = { error: errorText || 'Unknown error' }
				}
				throw new Error(
					errorData.error?.message ||
						errorData.error ||
						`HTTP error! status: ${response.status}`
				)
			}

			const data = await response.json()
			return data.devices || []
		} catch {
			return []
		}
	}

	/**
	 * Transfer playback to a device
	 */
	async transferPlayback(deviceId: string, play: boolean = false): Promise<boolean> {
		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return false
		}

		try {
			const response = await fetch(`${API_BASE_URL}/api/spotify/transfer-playback`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify({ device_ids: [deviceId], play }),
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
				throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
			}

			return true
		} catch {
			return false
		}
	}

	/**
	 * Get recently played tracks
	 */
	async getRecentlyPlayed(limit: number = 1): Promise<
		Array<{
			track: Record<string, unknown>
			context: Record<string, unknown> | null
			played_at: string
		}>
	> {
		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return []
		}

		try {
			const response = await fetch(
				`${API_BASE_URL}/api/spotify/recently-played?limit=${limit}`,
				{
					method: 'GET',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${accessToken}`,
					},
				}
			)

			if (!response.ok) {
				const errorText = await response.text()
				let errorData
				try {
					errorData = JSON.parse(errorText)
				} catch {
					errorData = { error: errorText || 'Unknown error' }
				}
				throw new Error(
					errorData.error?.message ||
						errorData.error ||
						`HTTP error! status: ${response.status}`
				)
			}

			const data = await response.json()
			return data.items || []
		} catch {
			return []
		}
	}

	/**
	 * Start/resume playback
	 */
	async startPlayback(contextUri?: string, positionMs?: number): Promise<boolean> {
		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return false
		}

		try {
			const body: Record<string, unknown> = {}
			if (contextUri) {
				body.context_uri = contextUri
			}
			if (positionMs !== undefined) {
				body.position_ms = positionMs
			}

			const response = await fetch(`${API_BASE_URL}/api/spotify/start-playback`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
				throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
			}

			return true
		} catch {
			return false
		}
	}

	/**
	 * Pause playback
	 */
	async pausePlayback(): Promise<boolean> {
		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return false
		}

		try {
			const response = await fetch(`${API_BASE_URL}/api/spotify/pause-playback`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
				throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
			}

			return true
		} catch {
			return false
		}
	}

	/**
	 * Skip to next track
	 */
	async skipToNext(): Promise<boolean> {
		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return false
		}

		try {
			const response = await fetch(`${API_BASE_URL}/api/spotify/skip-next`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
				throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
			}

			return true
		} catch {
			return false
		}
	}

	/**
	 * Skip to previous track
	 */
	async skipToPrevious(): Promise<boolean> {
		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return false
		}

		try {
			const response = await fetch(`${API_BASE_URL}/api/spotify/skip-previous`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
				throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
			}

			return true
		} catch {
			return false
		}
	}

	/**
	 * Get current user's profile
	 */
	async getUserProfile(): Promise<{
		display_name: string
		images: Array<{ url: string }>
		id: string
	} | null> {
		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return null
		}

		try {
			const response = await fetch(`${API_BASE_URL}/api/spotify/user-profile`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			})

			if (!response.ok) {
				const errorText = await response.text()
				let errorData
				try {
					errorData = JSON.parse(errorText)
				} catch {
					errorData = { error: errorText || 'Unknown error' }
				}
				throw new Error(
					errorData.error?.message ||
						errorData.error ||
						`HTTP error! status: ${response.status}`
				)
			}

			const data = await response.json()
			return data
		} catch {
			return null
		}
	}

	/**
	 * Extract track info from playback state
	 */
	private extractTrackInfo(playbackState: SpotifyPlaybackState): TrackInfo | null {
		if (!playbackState.item) return null

		const item = playbackState.item as {
			name: string
			artists: Array<{ name: string }>
			album: {
				name: string
				images: Array<{ url: string }>
			}
			duration_ms: number
			id: string
		}

		const artists = item.artists?.map((artist) => artist.name) || []
		if (artists.length === 0) {
			artists.push('Unknown Artist')
		}

		return {
			name: item.name || 'Unknown Track',
			artists: artists,
			album: item.album?.name || 'Unknown Album',
			albumCover: item.album?.images?.[0]?.url || '',
			duration: item.duration_ms || 0,
		}
	}

	/**
	 * Fetch context information (playlist, album, etc.)
	 */
	private async fetchContextInfo(contextUri: string | null): Promise<ContextInfo | null> {
		if (!contextUri) return null

		const accessToken = await this.getAccessToken()
		if (!accessToken) {
			return null
		}

		try {
			// Extract context type and ID from URI (e.g., "spotify:playlist:123" -> type: "playlist", id: "123")
			const uriMatch = contextUri.match(/spotify:(playlist|album|artist|show):([^:]+)/)
			if (!uriMatch) {
				return null
			}

			const [, type, id] = uriMatch
			let apiUrl = ''

			if (type === 'playlist') {
				apiUrl = `https://api.spotify.com/v1/playlists/${id}`
			} else if (type === 'album') {
				apiUrl = `https://api.spotify.com/v1/albums/${id}`
			} else if (type === 'artist') {
				apiUrl = `https://api.spotify.com/v1/artists/${id}`
			} else if (type === 'show') {
				apiUrl = `https://api.spotify.com/v1/shows/${id}`
			} else {
				return null
			}

			const response = await fetch(`${API_BASE_URL}/api/spotify/proxy`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify({
					url: apiUrl,
					method: 'GET',
				}),
			})

			if (!response.ok) {
				return null
			}

			const data = await response.json()

			return {
				type: type as 'playlist' | 'album' | 'artist' | 'show',
				name: data.name || 'Unknown',
				image: data.images?.[0]?.url || data.images?.[1]?.url || null,
				uri: contextUri,
			}
		} catch {
			return null
		}
	}

	/**
	 * Process playback state into UI-friendly format
	 */
	private async processPlaybackState(
		playbackState: SpotifyPlaybackState | null
	): Promise<PlaybackStateInfo> {
		if (!playbackState) {
			return {
				isPlaying: false,
				hasActivePlayback: false,
				activeDeviceName: null,
				trackInfo: null,
				progress: 0,
				contextUri: null,
				contextInfo: null,
			}
		}

		const isDeviceActive = playbackState.device?.is_active || false
		const trackInfo = isDeviceActive ? this.extractTrackInfo(playbackState) : null
		const contextUri = playbackState.context?.uri || null
		const contextInfo = contextUri ? await this.fetchContextInfo(contextUri) : null

		return {
			isPlaying: playbackState.is_playing || false,
			hasActivePlayback: isDeviceActive,
			activeDeviceName: playbackState.device?.name || null,
			trackInfo: trackInfo,
			progress: playbackState.progress_ms || 0,
			contextUri: contextUri,
			contextInfo: contextInfo,
		}
	}

	/**
	 * Attempt to connect to an available device
	 */
	private async connectToDevice(): Promise<boolean> {
		const devices = await this.getAvailableDevices()
		const availableDevices = devices.filter((device) => device.id)

		if (availableDevices.length === 0) {
			return false
		}

		const firstDevice = availableDevices[0]
		return await this.transferPlayback(firstDevice.id || '', false)
	}

	/**
	 * Handle device reconnection when playback exists but device is inactive
	 */
	private async handleDeviceReconnection(): Promise<PlaybackStateInfo | null> {
		const connected = await this.connectToDevice()
		if (!connected) {
			return {
				isPlaying: false,
				hasActivePlayback: false,
				activeDeviceName: null,
				trackInfo: null,
				progress: 0,
				contextUri: null,
				contextInfo: null,
			}
		}

		// Wait for transfer to complete
		await new Promise((resolve) => setTimeout(resolve, 500))

		const newPlaybackState = await this.getPlaybackState()
		if (newPlaybackState && newPlaybackState.device?.is_active) {
			return await this.processPlaybackState(newPlaybackState)
		}

		return {
			isPlaying: false,
			hasActivePlayback: false,
			activeDeviceName: null,
			trackInfo: null,
			progress: 0,
			contextUri: null,
			contextInfo: null,
		}
	}

	/**
	 * Load recently played track when no active playback
	 */
	private async loadRecentlyPlayedTrack(): Promise<{
		trackInfo: TrackInfo | null
		contextUri: string | null
	}> {
		const recentlyPlayed = await this.getRecentlyPlayed(1)
		if (recentlyPlayed.length === 0) {
			return { trackInfo: null, contextUri: null }
		}

		const recentTrack = recentlyPlayed[0]
		const track = recentTrack.track as {
			name: string
			artists: Array<{ name: string }>
			album: {
				name: string
				images: Array<{ url: string }>
			}
			duration_ms: number
		}

		const artists = track.artists?.map((artist) => artist.name) || []
		if (artists.length === 0) {
			artists.push('Unknown Artist')
		}

		const trackInfo: TrackInfo = {
			name: track.name || 'Unknown Track',
			artists: artists,
			album: track.album?.name || 'Unknown Album',
			albumCover: track.album?.images?.[0]?.url || '',
			duration: track.duration_ms || 0,
		}

		const contextUri = (recentTrack.context?.uri as string) || null

		return { trackInfo, contextUri }
	}

	/**
	 * Poll and update playback state with device management
	 */
	async pollAndUpdatePlaybackState(): Promise<PlaybackStateInfo> {
		const [playbackState, devices] = await Promise.all([
			this.getPlaybackState(),
			this.getAvailableDevices(),
		])

		const availableDevices = devices.filter((device) => device.id)

		// Case 1: Playback exists with active device
		if (playbackState && playbackState.device?.is_active) {
			return await this.processPlaybackState(playbackState)
		}

		// Case 2: Playback exists but device is not active - try to reconnect
		if (playbackState && !playbackState.device?.is_active && availableDevices.length > 0) {
			const reconnectedState = await this.handleDeviceReconnection()
			if (reconnectedState) {
				return reconnectedState
			}
		}

		// Case 3: No active playback but devices are available - try to connect
		if (!playbackState && availableDevices.length > 0) {
			const connected = await this.connectToDevice()
			if (connected) {
				// Wait for transfer to complete
				await new Promise((resolve) => setTimeout(resolve, 500))

				const newPlaybackState = await this.getPlaybackState()
				if (newPlaybackState && newPlaybackState.device?.is_active) {
					return await this.processPlaybackState(newPlaybackState)
				} else {
					// No active playback after transfer - load recently played
					const { trackInfo, contextUri } = await this.loadRecentlyPlayedTrack()
					const contextInfo = contextUri ? await this.fetchContextInfo(contextUri) : null
					return {
						isPlaying: false,
						hasActivePlayback: false,
						activeDeviceName: availableDevices[0]?.name || null,
						trackInfo,
						progress: 0,
						contextUri,
						contextInfo,
					}
				}
			}
		}

		// Case 4: No active playback and no available devices
		return {
			isPlaying: false,
			hasActivePlayback: false,
			activeDeviceName: null,
			trackInfo: null,
			progress: 0,
			contextUri: null,
			contextInfo: null,
		}
	}

	/**
	 * Initialize playback state (called once on authentication)
	 */
	async initializePlaybackState(): Promise<{
		playbackState: PlaybackStateInfo
		userProfile: {
			display_name: string
			images: Array<{ url: string }>
		} | null
	}> {
		// Get user profile
		const profile = await this.getUserProfile()
		const userProfile = profile
			? {
					display_name: profile.display_name,
					images: profile.images,
			  }
			: null

		// Get current playback state
		const playbackState = await this.getPlaybackState()

		if (playbackState && playbackState.device?.is_active) {
			// Active playback exists
			return {
				playbackState: await this.processPlaybackState(playbackState),
				userProfile,
			}
		}

		// No active playback - try to connect to device
		const devices = await this.getAvailableDevices()
		if (devices.length > 0) {
			// Transfer to first device (without playing)
			await this.transferPlayback(devices[0].id || '', false)

			// Load recently played track
			const { trackInfo, contextUri } = await this.loadRecentlyPlayedTrack()
			const contextInfo = contextUri ? await this.fetchContextInfo(contextUri) : null

			return {
				playbackState: {
					isPlaying: false,
					hasActivePlayback: false,
					activeDeviceName: devices[0]?.name || null,
					trackInfo,
					progress: 0,
					contextUri,
					contextInfo,
				},
				userProfile,
			}
		}

		// No devices available
		return {
			playbackState: {
				isPlaying: false,
				hasActivePlayback: false,
				activeDeviceName: null,
				trackInfo: null,
				progress: 0,
				contextUri: null,
				contextInfo: null,
			},
			userProfile,
		}
	}
}

// Export a singleton instance
export const spotifyService = new SpotifyService()
