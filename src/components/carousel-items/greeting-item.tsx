import { useState, useEffect } from 'react'

function GreetingItem() {
	const [currentTime, setCurrentTime] = useState(new Date())

	useEffect(() => {
		const timer = setInterval(() => {
			setCurrentTime(new Date())
		}, 1000)

		return () => clearInterval(timer)
	}, [])

	const formattedTime = currentTime.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	})

	const formattedDate = currentTime.toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
	})

	const getGreeting = () => {
		const hour = currentTime.getHours()
		if (hour >= 5 && hour < 12) {
			return 'Good morning'
		} else if (hour >= 12 && hour < 17) {
			return 'Good afternoon'
		} else if (hour >= 17 && hour < 21) {
			return 'Good evening'
		} else {
			return 'Good night'
		}
	}

	return (
		<div className="w-full h-full shrink-0 flex items-center justify-center p-8">
			<div className="flex flex-col items-center gap-6">
				<div className="text-8xl font-bold tracking-tight">{formattedTime}</div>
				<div className="text-5xl font-semibold">{getGreeting()}, Yash.</div>
				<div className="text-3xl font-medium text-muted-foreground">{formattedDate}</div>
			</div>
		</div>
	)
}

export default GreetingItem
