import type { DAVCalendar, DAVCalendarObject } from 'tsdav'
import ICAL from 'ical.js'
import { endOfDay, isSameDay, parseISO } from 'date-fns'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export interface CalendarEvent {
	dtstart: string
	dtend: string
	summary: string
	description?: string
	location?: string
	rrule: string | null
	calendarName: string
	calendarId: string
	calendarColor?: string
}

export interface EventsByCalendar {
	calendar: {
		id: string
		displayName: string
		color?: string
	}
	events: CalendarEvent[]
}

class ICloudService {
	private calendars: DAVCalendar[] = []

	/**
	 * Fetch all calendars from the iCloud account via backend API
	 */
	async fetchCalendars(): Promise<DAVCalendar[]> {
		const response = await fetch(`${API_BASE_URL}/api/icloud/calendars`, {
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
		this.calendars = data.calendars || []
		return this.calendars
	}

	/**
	 * Fetch calendar objects for a specific calendar
	 */
	async fetchCalendarObjects(calendar: DAVCalendar): Promise<DAVCalendarObject[]> {
		const response = await fetch(`${API_BASE_URL}/api/icloud/calendar-objects`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ calendar }),
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
			throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
		}

		const data = await response.json()
		return data.calendarObjects || []
	}

	/**
	 * Parse iCalendar data and extract event properties
	 */
	private parseEventData(
		icalData: string,
		calendarName: string,
		calendarId: string,
		calendarColor?: string
	): CalendarEvent | null {
		try {
			if (!icalData || typeof icalData !== 'string') {
				console.error('Invalid iCalendar data:', typeof icalData)
				return null
			}

			const jcalData = ICAL.parse(icalData)
			if (!jcalData || !Array.isArray(jcalData) || jcalData.length < 2) {
				console.error('Invalid parsed jcalData structure:', jcalData)
				return null
			}

			// Create component from the full jcalData array
			// jcalData structure: ["vcalendar", properties, subcomponents]
			const comp = new ICAL.Component(jcalData)
			const vevent = comp.getFirstSubcomponent('vevent')

			// Debug: log component structure if vevent not found
			if (!vevent) {
				const subcomponents = comp.getAllSubcomponents()
				console.error('No vevent found. Component structure:', {
					componentName: comp.name,
					subcomponents: subcomponents.map((c: ICAL.Component) => c.name),
					allProperties: comp.getAllProperties().map((p: ICAL.Property) => p.name),
				})
				return null
			}

			const dtstartProp = vevent.getFirstProperty('dtstart')
			const dtendProp = vevent.getFirstProperty('dtend')
			const summaryProp = vevent.getFirstProperty('summary')
			const descriptionProp = vevent.getFirstProperty('description')
			const locationProp = vevent.getFirstProperty('location')
			const rruleProp = vevent.getFirstProperty('rrule')

			if (!dtstartProp) {
				console.error('No DTSTART property found')
				return null
			}

			const dtstartValue = dtstartProp.getFirstValue()
			const dtendValue = dtendProp?.getFirstValue()
			const summary = summaryProp?.getFirstValue() || ''
			const description = descriptionProp?.getFirstValue() || ''
			const location = locationProp?.getFirstValue() || ''
			const rrule = rruleProp?.getFirstValue()

			// Convert ICAL.Time to Date
			const dtstart = dtstartValue instanceof ICAL.Time ? dtstartValue.toJSDate() : null
			const dtend = dtendValue instanceof ICAL.Time ? dtendValue.toJSDate() : null

			if (!dtstart) {
				console.error('DTSTART value is not an ICAL.Time:', dtstartValue)
				return null
			}

			// Convert RRULE to string if it exists
			let rruleString: string | null = null
			if (rrule) {
				rruleString = rrule.toString()
			}

			return {
				dtstart: dtstart.toISOString(),
				dtend: dtend?.toISOString() || dtstart.toISOString(),
				summary: summary.toString(),
				description: description ? description.toString() : undefined,
				location: location ? location.toString() : undefined,
				rrule: rruleString,
				calendarName,
				calendarId,
				calendarColor,
			}
		} catch (error) {
			console.error('Error parsing iCalendar data:', error)
			if (error instanceof Error) {
				console.error('Error message:', error.message)
				console.error('Error stack:', error.stack)
			}
			return null
		}
	}

	/**
	 * Check if a recurring event occurs on a specific date
	 */
	private eventOccursOnDate(
		dtstart: Date,
		rrule: string | null,
		targetDate: Date,
		icalData: string
	): boolean {
		if (!rrule) {
			// Single event - check if it's on the target date
			return isSameDay(dtstart, targetDate)
		}

		try {
			// Use ICAL.Event to handle recurring events
			const jcalData = ICAL.parse(icalData)
			const comp = new ICAL.Component(jcalData)
			const vevent = comp.getFirstSubcomponent('vevent')

			if (!vevent) {
				return isSameDay(dtstart, targetDate)
			}

			const event = new ICAL.Event(vevent)
			const targetEnd = endOfDay(targetDate)

			// Check if event is recurring
			if (event.isRecurring()) {
				// Use iterator to check occurrences
				const iterator = event.iterator()

				// Start iterating from the beginning
				// The first call to next() returns the start time
				let occurrence = iterator.next()
				let iterations = 0
				const maxIterations = 1000

				console.log(`Checking recurring event for ${targetDate.toLocaleDateString()}`)
				console.log(`Event start: ${dtstart.toLocaleDateString()}, RRULE: ${rrule}`)

				while (occurrence && iterations < maxIterations) {
					const occurrenceDate = occurrence.toJSDate()
					console.log(
						`  Checking occurrence ${
							iterations + 1
						}: ${occurrenceDate.toLocaleDateString()} ${occurrenceDate.toLocaleTimeString()}`
					)

					// Check if occurrence is on the same day as target date
					if (isSameDay(occurrenceDate, targetDate)) {
						console.log(`  ✓ Match found!`)
						return true
					}

					// If we've passed the target date, stop
					if (occurrenceDate > targetEnd) {
						console.log(
							`  Stopping: occurrence ${occurrenceDate.toLocaleDateString()} is after target ${targetDate.toLocaleDateString()}`
						)
						break
					}

					occurrence = iterator.next()
					iterations++
				}

				console.log(`  No match found after ${iterations} iterations`)
				return false
			} else {
				// Single event - check if it's on the target date
				return isSameDay(dtstart, targetDate)
			}
		} catch (error) {
			console.error('Error checking recurring event:', error)
			// Fallback: check if the original event date matches
			return isSameDay(dtstart, targetDate)
		}
	}

	/**
	 * Get events for a specific date from all calendars, grouped by calendar
	 */
	async getEventsForDate(targetDate: Date = new Date()): Promise<EventsByCalendar[]> {
		const eventsByCalendar: Map<string, CalendarEvent[]> = new Map()
		const calendarInfo: Map<string, { displayName: string; color?: string }> = new Map()

		try {
			const calendars = await this.fetchCalendars()
			console.log(`Fetching events for ${targetDate.toLocaleDateString()}`)
			console.log(`Found ${calendars.length} calendars`)

			for (const calendar of calendars) {
				try {
					const calendarObjects = await this.fetchCalendarObjects(calendar)
					console.log(
						`Calendar "${calendar.displayName}": ${calendarObjects.length} objects`
					)

					const calendarEvents: CalendarEvent[] = []

					for (const obj of calendarObjects) {
						if (!obj.data) {
							console.log('  Skipping object: no data')
							continue
						}

						// Ensure data is a string
						if (typeof obj.data !== 'string') {
							console.log(
								`  Skipping object: data is not a string (type: ${typeof obj.data})`
							)
							continue
						}

						// Log first few characters of data to see what we're working with
						console.log(
							`  Object data preview (first 200 chars): ${obj.data.substring(0, 200)}`
						)

						const calendarId = calendar.url || `calendar-${calendars.indexOf(calendar)}`
						const calendarName =
							typeof calendar.displayName === 'string'
								? calendar.displayName
								: 'Unknown'
						const calendarColor =
							typeof calendar.calendarColor === 'string'
								? calendar.calendarColor
								: undefined
						const eventData = this.parseEventData(
							obj.data,
							calendarName,
							calendarId,
							calendarColor
						)

						if (!eventData) {
							console.log('  Skipping object: failed to parse')
							continue
						}

						const dtstart = parseISO(eventData.dtstart)
						console.log(
							`  Event: "${
								eventData.summary
							}" - Start: ${dtstart.toLocaleDateString()} - RRULE: ${
								eventData.rrule || 'none'
							}`
						)

						// Check if event occurs on target date
						const occursOnDate = this.eventOccursOnDate(
							dtstart,
							eventData.rrule,
							targetDate,
							obj.data
						)
						console.log(
							`    Occurs on ${targetDate.toLocaleDateString()}: ${occursOnDate}`
						)

						if (occursOnDate) {
							calendarEvents.push(eventData)
						}
					}

					// Store calendar info and events
					if (calendarEvents.length > 0 || calendarObjects.length > 0) {
						const calendarId = calendar.url || `calendar-${calendars.indexOf(calendar)}`
						const calendarName =
							typeof calendar.displayName === 'string'
								? calendar.displayName
								: 'Unknown'
						const calendarColor =
							typeof calendar.calendarColor === 'string'
								? calendar.calendarColor
								: undefined
						eventsByCalendar.set(calendarId, calendarEvents)
						calendarInfo.set(calendarId, {
							displayName: calendarName,
							color: calendarColor,
						})
					}
				} catch (error) {
					console.error(
						`Error fetching calendar objects for ${calendar.displayName}:`,
						error
					)
				}
			}
		} catch (error) {
			console.error('Error fetching events:', error)
		}

		// Convert Map to array format
		const result: EventsByCalendar[] = []
		for (const [calendarId, events] of eventsByCalendar.entries()) {
			const info = calendarInfo.get(calendarId)
			if (info) {
				result.push({
					calendar: {
						id: calendarId,
						displayName: info.displayName,
						color: info.color,
					},
					events,
				})
			}
		}

		console.log(
			`Total events found: ${result.reduce((sum, cal) => sum + cal.events.length, 0)}`
		)
		console.log(`Calendars with events: ${result.length}`)
		return result
	}

	/**
	 * Get the stored calendars (call fetchCalendars first)
	 */
	getCalendars(): DAVCalendar[] {
		return this.calendars
	}
}

// Export a singleton instance
export const iCloudService = new ICloudService()
