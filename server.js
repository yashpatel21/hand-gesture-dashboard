import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createDAVClient } from 'tsdav'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

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

app.listen(PORT, () => {
	console.log(`Backend server running on http://localhost:${PORT}`)
})
