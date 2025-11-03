import { useState, useEffect, useRef, useCallback } from 'react'
import { useGestureRecognition } from '@/hooks/useGestureRecognition'
import GreetingItem from './carousel-items/greeting-item'
import WidgetItem from './carousel-items/widget-item'
import MusicItem from './carousel-items/music-item'
import Cursor from './cursor'

const TOTAL_SLIDES = 3 // Number of carousel items

function Dashboard() {
	const [currentIndex, setCurrentIndex] = useState(0)
	const [bounceOffset, setBounceOffset] = useState(0) // Offset for elastic bounce effect
	const bounceTimeoutRef = useRef<number | null>(null)
	const { temporalGesture } = useGestureRecognition()

	// Elastic bounce effect function
	const elasticBounce = useCallback((initialOffset: number) => {
		// Clear any existing bounce timeout
		if (bounceTimeoutRef.current) {
			clearTimeout(bounceTimeoutRef.current)
		}

		// Set initial bounce
		setBounceOffset(initialOffset)

		// Animate bounce back with easing - more pronounced steps
		const bounceSteps = [
			initialOffset * 0.7,
			initialOffset * 0.4,
			initialOffset * 0.2,
			initialOffset * 0.05,
			0,
		]

		let stepIndex = 0
		const animate = () => {
			if (stepIndex < bounceSteps.length) {
				setBounceOffset(bounceSteps[stepIndex])
				stepIndex++
				bounceTimeoutRef.current = window.setTimeout(animate, 60)
			} else {
				setBounceOffset(0)
				bounceTimeoutRef.current = null
			}
		}

		// Start animation
		bounceTimeoutRef.current = window.setTimeout(animate, 60)
	}, [])

	// Handle swipe gestures to navigate carousel with elastic bounce at boundaries
	useEffect(() => {
		if (!temporalGesture) return

		if (temporalGesture.gesture === 'click') {
			console.log('dash click detected!')
		}

		if (temporalGesture.gesture === 'swipe_left') {
			// Swipe left = next item (increment)
			setCurrentIndex((prevIndex) => {
				const newIndex = Math.min(prevIndex + 1, TOTAL_SLIDES - 1)

				if (newIndex === prevIndex) {
					// At the rightmost page, create bounce effect
					elasticBounce(-20) // Bounce to the left (negative X offset)
				}
				return newIndex
			})
		} else if (temporalGesture.gesture === 'swipe_right') {
			// Swipe right = previous item (decrement)
			setCurrentIndex((prevIndex) => {
				const newIndex = Math.max(prevIndex - 1, 0)

				if (newIndex === prevIndex) {
					// At the leftmost page, create bounce effect
					elasticBounce(20) // Bounce to the right (positive X offset)
				}
				return newIndex
			})
		}
	}, [temporalGesture, elasticBounce])

	// Cleanup bounce timeout on unmount
	useEffect(() => {
		return () => {
			if (bounceTimeoutRef.current) {
				clearTimeout(bounceTimeoutRef.current)
			}
		}
	}, [])

	return (
		<div className="w-full h-screen overflow-hidden relative bg-background">
			{/* Carousel Container */}
			<div
				className="flex h-full"
				style={{
					transform: `translateX(calc(-${currentIndex * 100}% + ${bounceOffset}px))`,
					transition:
						bounceOffset === 0
							? 'transform 0.3s ease-in-out'
							: 'transform 0.05s ease-out', // Faster transition for bounce
				}}
			>
				<GreetingItem />
				<WidgetItem />
				<MusicItem />
			</div>

			{/* Navigation Indicators */}
			<div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
				{[0, 1, 2].map((index) => (
					<button
						key={index}
						onClick={() => setCurrentIndex(index)}
						className={`w-2 h-2 rounded-full transition-all ${
							index === currentIndex ? 'bg-primary w-8' : 'bg-muted-foreground/50'
						}`}
						aria-label={`Go to slide ${index + 1}`}
					/>
				))}
			</div>

			{/* Cursor */}
			<Cursor temporalGesture={temporalGesture} />
		</div>
	)
}

export default Dashboard
