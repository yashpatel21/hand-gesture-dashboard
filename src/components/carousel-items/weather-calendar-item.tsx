import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sun, Calendar as CalendarIcon, Loader2 } from 'lucide-react'

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
	const getCurrentDate = () => {
		const today = new Date()
		const options: Intl.DateTimeFormatOptions = {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
		}
		return today.toLocaleDateString('en-US', options)
	}

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
				<div className="space-y-3">
					<div className="flex items-center gap-4 p-3 rounded-lg bg-muted">
						<div className="text-sm font-semibold w-16">10:00 AM</div>
						<div>
							<div className="font-medium">Team Meeting</div>
							<div className="text-sm text-muted-foreground">Conference Room A</div>
						</div>
					</div>
					<div className="flex items-center gap-4 p-3 rounded-lg bg-muted">
						<div className="text-sm font-semibold w-16">2:00 PM</div>
						<div>
							<div className="font-medium">Project Review</div>
							<div className="text-sm text-muted-foreground">Virtual Meeting</div>
						</div>
					</div>
					<div className="flex items-center gap-4 p-3 rounded-lg bg-muted">
						<div className="text-sm font-semibold w-16">5:00 PM</div>
						<div>
							<div className="font-medium">Dentist Appointment</div>
							<div className="text-sm text-muted-foreground">Downtown Office</div>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function WeatherCalendarItem() {
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

export default WeatherCalendarItem
