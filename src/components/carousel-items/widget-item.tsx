import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Sun, Calendar as CalendarIcon, Loader2, MapPin, Clock } from 'lucide-react'
import { iCloudService, type EventsByCalendar, type CalendarEvent } from '@/lib/icloud-service'

interface WeatherData {
	temp: number
	feelsLike: number
	description: string
	location: string
	high: number
	low: number
	humidity: number
	icon: string
}

function WeatherWidget() {
	const [weather, setWeather] = useState<WeatherData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const fetchWeather = async () => {
			try {
				setLoading(true)
				setError(null)

				// Get user location
				const position = await new Promise<GeolocationPosition>((resolve, reject) => {
					navigator.geolocation.getCurrentPosition(resolve, reject)
				})

				const { latitude, longitude } = position.coords

				// Get API key from environment variable
				const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY
				if (!apiKey) {
					throw new Error(
						'OpenWeatherMap API key not found. Please set VITE_OPENWEATHER_API_KEY in your .env file.'
					)
				}

				// Fetch weather data
				const weatherResponse = await fetch(
					`https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=imperial`
				)

				if (!weatherResponse.ok) {
					throw new Error('Failed to fetch weather data')
				}

				const weatherData = await weatherResponse.json()

				// Fetch reverse geocoding for location name
				const geoResponse = await fetch(
					`https://api.openweathermap.org/geo/1.0/reverse?lat=${latitude}&lon=${longitude}&limit=1&appid=${apiKey}`
				)

				let locationName = 'Unknown Location'
				if (geoResponse.ok) {
					const geoData = await geoResponse.json()
					if (geoData && geoData.length > 0) {
						const city = geoData[0].name
						const state = geoData[0].state || ''
						locationName = state ? `${city}, ${state}` : city
					}
				}

				// Get forecast for high/low
				const forecastResponse = await fetch(
					`https://api.openweathermap.org/data/2.5/forecast?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=imperial&cnt=40`
				)

				let high = weatherData.main.temp_max
				let low = weatherData.main.temp_min

				if (forecastResponse.ok) {
					const forecastData = await forecastResponse.json()
					if (forecastData.list && forecastData.list.length > 0) {
						const temps = forecastData.list.map(
							(item: { main: { temp: number } }) => item.main.temp
						)
						high = Math.max(...temps, high)
						low = Math.min(...temps, low)
					}
				}

				setWeather({
					temp: Math.round(weatherData.main.temp),
					feelsLike: Math.round(weatherData.main.feels_like),
					description:
						weatherData.weather[0].description.charAt(0).toUpperCase() +
						weatherData.weather[0].description.slice(1),
					location: locationName,
					high: Math.round(high),
					low: Math.round(low),
					humidity: weatherData.main.humidity,
					icon: weatherData.weather[0].icon, // Use icon code from API (e.g., "10d", "01n")
				})
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to fetch weather data')
			} finally {
				setLoading(false)
			}
		}

		fetchWeather()
	}, [])

	const getWeatherIconUrl = (iconCode: string): string => {
		// OpenWeatherMap icon URL format: https://openweathermap.org/img/wn/{icon}@2x.png
		return `https://openweathermap.org/img/wn/${iconCode}@2x.png`
	}

	if (loading) {
		return (
			<Card className="w-full">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Sun className="h-5 w-5" />
						Weather
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		)
	}

	if (error) {
		return (
			<Card className="w-full">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Sun className="h-5 w-5" />
						Weather
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-destructive">{error}</div>
				</CardContent>
			</Card>
		)
	}

	if (!weather) {
		return null
	}

	return (
		<Card className="w-full">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Sun className="h-5 w-5" />
					Weather
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="flex items-center justify-between">
					<div>
						<div className="text-5xl font-bold">{weather.temp}°F</div>
						<div className="text-muted-foreground text-lg">{weather.description}</div>
						<div className="text-sm text-muted-foreground mt-2">{weather.location}</div>
					</div>
					<img
						src={getWeatherIconUrl(weather.icon)}
						alt={weather.description}
						className="h-20 w-20"
					/>
				</div>
				<div className="flex gap-6 mt-6 text-sm">
					<div>
						<div className="text-muted-foreground">High</div>
						<div className="font-semibold">{weather.high}°F</div>
					</div>
					<div>
						<div className="text-muted-foreground">Low</div>
						<div className="font-semibold">{weather.low}°F</div>
					</div>
					<div>
						<div className="text-muted-foreground">Humidity</div>
						<div className="font-semibold">{weather.humidity}%</div>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function TodayWidget() {
	const [eventsByCalendar, setEventsByCalendar] = useState<EventsByCalendar[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
	const [isDialogOpen, setIsDialogOpen] = useState(false)

	useEffect(() => {
		const fetchTodayEvents = async () => {
			try {
				setLoading(true)
				setError(null)

				// Change this date to test different dates
				const targetDate = new Date()

				const events = await iCloudService.getEventsForDate(targetDate)
				setEventsByCalendar(events)
			} catch (err) {
				setError(err instanceof Error ? err.message : "Error fetching today's events")
			} finally {
				setLoading(false)
			}
		}

		fetchTodayEvents()
	}, [])

	const getCurrentDate = () => {
		const today = new Date()
		const options: Intl.DateTimeFormatOptions = {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
		}
		return today.toLocaleDateString('en-US', options)
	}

	const formatTime = (dateString: string) => {
		const date = new Date(dateString)
		return date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
		})
	}

	const formatDateTime = (dateString: string) => {
		const date = new Date(dateString)
		return date.toLocaleString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
		})
	}

	const handleEventClick = (event: CalendarEvent) => {
		setSelectedEvent(event)
		setIsDialogOpen(true)
	}

	const getCalendarColor = (color?: string) => {
		if (!color) return 'hsl(var(--primary))'
		// iCloud calendar colors are typically in hex format
		// If it's already a valid color, use it
		if (color.startsWith('#')) return color
		// If it's a CSS color name, return it
		if (/^[a-z]+$/i.test(color)) return color
		// Otherwise, try to use it as-is
		return color
	}

	if (loading) {
		return (
			<Card className="w-full">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<CalendarIcon className="h-5 w-5" />
						Today
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		)
	}

	if (error) {
		return (
			<Card className="w-full">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<CalendarIcon className="h-5 w-5" />
						Today
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-destructive">{error}</div>
				</CardContent>
			</Card>
		)
	}

	// Filter out calendars with no events
	const calendarsWithEvents = eventsByCalendar.filter((cal) => cal.events.length > 0)
	const totalEvents = calendarsWithEvents.reduce((sum, cal) => sum + cal.events.length, 0)

	return (
		<Card className="w-full">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<CalendarIcon className="h-5 w-5" />
					Today
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-bold mb-4">{getCurrentDate()}</div>

				{totalEvents === 0 ? (
					<div className="text-sm text-muted-foreground py-4">
						No events scheduled for today
					</div>
				) : (
					<div className="space-y-6">
						{calendarsWithEvents.map((calendarGroup, groupIndex) => (
							<div key={calendarGroup.calendar.id}>
								{/* Calendar Header */}
								<div className="flex items-center gap-3 mb-3">
									<div
										className="w-3 h-3 rounded-full shrink-0"
										style={{
											backgroundColor: getCalendarColor(
												calendarGroup.calendar.color
											),
										}}
									/>
									<Badge variant="outline" className="font-medium">
										{calendarGroup.calendar.displayName}
									</Badge>
									<span className="text-xs text-muted-foreground">
										{calendarGroup.events.length}{' '}
										{calendarGroup.events.length === 1 ? 'event' : 'events'}
									</span>
								</div>

								{/* Events for this calendar */}
								<div className="space-y-2 ml-6">
									{[...calendarGroup.events]
										.sort((a, b) => {
											const dateA = new Date(a.dtstart).getTime()
											const dateB = new Date(b.dtstart).getTime()
											return dateA - dateB
										})
										.map((event, eventIndex) => (
											<div key={`${event.dtstart}-${eventIndex}`}>
												<div
													className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer interactive"
													onClick={() => handleEventClick(event)}
												>
													{/* Event details */}
													<div className="flex-1 min-w-0">
														<div className="font-medium text-base mb-1">
															{event.summary}
														</div>
														{event.location && (
															<div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
																<MapPin className="h-3 w-3 shrink-0" />
																<span className="truncate">
																	{event.location}
																</span>
															</div>
														)}
														{event.description && (
															<div className="text-sm text-muted-foreground line-clamp-2 mb-1">
																{event.description}
															</div>
														)}
														{/* Time section - horizontal, below description */}
														<div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
															<Clock className="h-3 w-3 shrink-0" />
															<span className="whitespace-nowrap">
																{formatTime(event.dtstart)}
																{event.dtstart !== event.dtend && (
																	<>
																		{' '}
																		- {formatTime(event.dtend)}
																	</>
																)}
															</span>
														</div>
													</div>
												</div>
											</div>
										))}
								</div>

								{/* Separator between calendar groups */}
								{groupIndex < calendarsWithEvents.length - 1 && (
									<Separator className="mt-6" />
								)}
							</div>
						))}
					</div>
				)}
			</CardContent>

			{/* Event Details Dialog */}
			<Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
				<DialogContent className="max-w-2xl">
					{selectedEvent && (
						<>
							<DialogHeader>
								<DialogTitle className="text-2xl">
									{selectedEvent.summary}
								</DialogTitle>
								<DialogDescription>
									<div className="flex items-center gap-2 mt-2">
										<div
											className="w-3 h-3 rounded-full shrink-0"
											style={{
												backgroundColor: getCalendarColor(
													selectedEvent.calendarColor
												),
											}}
										/>
										<span className="text-sm">
											{selectedEvent.calendarName}
										</span>
									</div>
								</DialogDescription>
							</DialogHeader>

							<div className="space-y-4 mt-4">
								{/* Date and Time */}
								<div className="space-y-2">
									<div className="flex items-start gap-3">
										<Clock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
										<div className="flex-1">
											<div className="text-sm font-medium text-muted-foreground mb-1">
												Start Time
											</div>
											<div className="text-base">
												{formatDateTime(selectedEvent.dtstart)}
											</div>
										</div>
									</div>
									{selectedEvent.dtstart !== selectedEvent.dtend && (
										<div className="flex items-start gap-3 ml-8">
											<div className="flex-1">
												<div className="text-sm font-medium text-muted-foreground mb-1">
													End Time
												</div>
												<div className="text-base">
													{formatDateTime(selectedEvent.dtend)}
												</div>
											</div>
										</div>
									)}
								</div>

								{/* Location */}
								{selectedEvent.location && (
									<div className="flex items-start gap-3">
										<MapPin className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
										<div className="flex-1">
											<div className="text-sm font-medium text-muted-foreground mb-1">
												Location
											</div>
											<div className="text-base">
												{selectedEvent.location}
											</div>
										</div>
									</div>
								)}

								{/* Description */}
								{selectedEvent.description && (
									<div className="space-y-2">
										<div className="text-sm font-medium text-muted-foreground">
											Description
										</div>
										<div className="text-base whitespace-pre-wrap">
											{selectedEvent.description}
										</div>
									</div>
								)}

								{/* Recurring Event Info */}
								{selectedEvent.rrule && (
									<div className="space-y-2">
										<div className="text-sm font-medium text-muted-foreground">
											Recurrence
										</div>
										<Badge variant="outline" className="text-xs">
											Recurring Event
										</Badge>
									</div>
								)}
							</div>
						</>
					)}
				</DialogContent>
			</Dialog>
		</Card>
	)
}

function WidgetItem() {
	return (
		<div className="w-full h-full shrink-0 flex items-center justify-center gap-6 p-8 overflow-y-auto">
			<div className="flex flex-col gap-6 w-full max-w-4xl">
				{/* Weather Widget */}
				<WeatherWidget />

				{/* Today Widget */}
				<TodayWidget />
			</div>
		</div>
	)
}

export default WidgetItem
