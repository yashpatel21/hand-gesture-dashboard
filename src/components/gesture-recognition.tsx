import { useEffect, useState, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { useGestureRecognition, useGestureVideoStream } from '@/hooks/useGestureRecognition'
import { drawLandmarks, clearLandmarks } from '@/lib/gesture-utils'
import GestureRecognitionService from '@/lib/gesture-recognition-service'

function GestureRecognition() {
	const [currentGesture, setCurrentGesture] = useState<string>('No gesture detected')
	const [isVisible, setIsVisible] = useState<boolean>(true)
	const videoRef = useRef<HTMLVideoElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const animationFrameRef = useRef<number | null>(null)

	// Subscribe to temporal gestures only (React state updates only on detection)
	const { temporalGesture } = useGestureRecognition()

	// Get video stream from service for display
	const videoStream = useGestureVideoStream()

	// Set video stream to our video element
	useEffect(() => {
		if (videoStream && videoRef.current) {
			videoRef.current.srcObject = videoStream
		}
	}, [videoStream])

	// Render frame data using requestAnimationFrame (outside React lifecycle)
	useEffect(() => {
		const service = GestureRecognitionService.getInstance()
		const canvas = canvasRef.current
		const video = videoRef.current

		if (!canvas || !video) return

		const render = () => {
			// Get current frame data from service (no React state)
			const frameData = service.getCurrentFrameData()

			if (frameData) {
				const { topGesture, landmarks } = frameData

				// Update gesture badge (this is the only React state update for rendering)
				if (topGesture) {
					setCurrentGesture(
						`${topGesture.categoryName} (${(topGesture.score * 100).toFixed(1)}%)`
					)
				} else {
					setCurrentGesture('No hand detected')
				}

				// Draw landmarks on canvas (outside React lifecycle)
				if (landmarks && landmarks.length > 0) {
					drawLandmarks(landmarks, canvas, video)
				} else {
					clearLandmarks(canvas)
				}
			} else {
				clearLandmarks(canvas)
			}

			// Continue rendering loop
			animationFrameRef.current = requestAnimationFrame(render)
		}

		// Start rendering loop
		animationFrameRef.current = requestAnimationFrame(render)

		// Cleanup
		return () => {
			if (animationFrameRef.current !== null) {
				cancelAnimationFrame(animationFrameRef.current)
			}
		}
	}, [])

	return (
		<>
			{/* Gesture Badge - Always visible, floating */}
			<div className="fixed bottom-4 right-4 z-50">
				<Badge variant="secondary" className="text-sm font-semibold whitespace-nowrap">
					{currentGesture}
				</Badge>
				<Badge variant="secondary" className="text-sm font-semibold whitespace-nowrap">
					{temporalGesture?.gesture || 'Null'}{' '}
					{temporalGesture?.gesture === 'point'
						? `(${temporalGesture.x?.toFixed(2)}, ${temporalGesture.y?.toFixed(2)})`
						: ''}
				</Badge>
			</div>

			{/* Video feed with toggle - Slides in/out - Positioned above badge */}
			<div className="fixed bottom-20 right-0 z-50">
				{/* Container that slides together - stops at edge so button is always visible */}
				<div
					className={`flex items-center transition-transform duration-300 ease-in-out ${
						isVisible ? 'translate-x-0' : 'translate-x-64' // Slide by card width (w-64) to hide card completely
					}`}
				>
					{/* Tab button on the left */}
					<button
						onClick={() => setIsVisible(!isVisible)}
						className="bg-card border border-r-0 border-border rounded-l-md px-2 py-4 shadow-lg hover:bg-accent transition-colors z-10 shrink-0"
						aria-label={
							isVisible ? 'Hide gesture recognition' : 'Show gesture recognition'
						}
					>
						{isVisible ? (
							<ChevronRight className="h-4 w-4" />
						) : (
							<ChevronLeft className="h-4 w-4" />
						)}
					</button>

					{/* Card - Video feed only, slides in/out with button */}
					<Card className="relative w-64 overflow-hidden p-0">
						{/* Video Container */}
						<div className="relative w-full">
							<video
								ref={videoRef}
								id="video"
								className="w-full h-auto"
								playsInline
								muted
								autoPlay
							/>
							<canvas
								ref={canvasRef}
								className="absolute top-0 left-0 w-full h-full pointer-events-none"
								style={{ width: '100%', height: '100%', objectFit: 'contain' }}
							/>
						</div>
					</Card>
				</div>
			</div>
		</>
	)
}

export default GestureRecognition
