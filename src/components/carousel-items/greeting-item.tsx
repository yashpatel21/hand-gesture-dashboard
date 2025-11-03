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

	return (
		<div className="w-full h-full shrink-0 flex items-center justify-center p-8">
			<div className="flex flex-col items-center gap-4">
				<div className="text-6xl font-bold">Good evening, Yash.</div>
				<div className="text-4xl font-medium text-muted-foreground">{formattedTime}</div>
			</div>
		</div>
	)
}

export default GreetingItem
