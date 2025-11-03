import { useEffect, useState, useRef } from 'react'
import { flushSync } from 'react-dom'
import GestureRecognitionService from '@/lib/gesture-recognition-service'
import type { TemporalGestureResult } from '@/types/gesture'

interface UseGestureRecognitionOptions {
	// Model asset path (only used on first initialization)
	modelAssetPath?: string
	// Number of hands to detect (only used on first initialization)
	numHands?: number
	// Buffer size for temporal gestures (default: 15)
	bufferSize?: number
	// EMA smoothing factor (0-1, lower = more smoothing, default: 0.3)
	emaAlpha?: number
	// Sliding majority filter window size (3 or 5, default: 3)
	majorityWindowSize?: number
	// Maximum gap size (in frames) to merge (default: 2)
	maxGapSize?: number
}

/**
 * Hook for subscribing to temporal gesture events
 *
 * This hook subscribes to the singleton GestureRecognitionService
 * which handles initialization, webcam access, buffer management, and
 * temporal gesture detection outside of React lifecycle.
 *
 * Multiple components/hooks can use this hook and they will all
 * receive temporal gesture events without redundant processing.
 *
 * All processing (buffer management, gesture detection) happens in the
 * service outside React, so React state updates only occur when a
 * temporal gesture is actually detected.
 *
 * @example
 * ```tsx
 * const { temporalGesture } = useGestureRecognition()
 *
 * // temporalGesture: TemporalGestureResult | null
 * // Can be { gesture: 'swipe_left' }, { gesture: 'swipe_right' },
 * // { gesture: 'point', x: number, y: number }, or null
 * ```
 */
export function useGestureRecognition(options: UseGestureRecognitionOptions = {}) {
	const [temporalGesture, setTemporalGesture] = useState<TemporalGestureResult | null>(null)
	const serviceRef = useRef<GestureRecognitionService | null>(null)
	const clearGestureTimeoutRef = useRef<number | null>(null)

	useEffect(() => {
		// Get or create the singleton service instance
		const service = GestureRecognitionService.getInstance({
			modelAssetPath: options.modelAssetPath,
			numHands: options.numHands,
			bufferSize: options.bufferSize,
			emaAlpha: options.emaAlpha,
			majorityWindowSize: options.majorityWindowSize,
			maxGapSize: options.maxGapSize,
		})

		serviceRef.current = service

		// Update temporal gesture options when they change
		service.updateTemporalGestureOptions({
			bufferSize: options.bufferSize,
			emaAlpha: options.emaAlpha,
			majorityWindowSize: options.majorityWindowSize,
			maxGapSize: options.maxGapSize,
		})

		// Subscribe to temporal gesture events only (triggers React state update)
		// All processing happens in the service outside React lifecycle
		const unsubscribe = service.subscribeToTemporalGestures((result: TemporalGestureResult) => {
			// Clear any existing timeout
			if (clearGestureTimeoutRef.current !== null) {
				clearTimeout(clearGestureTimeoutRef.current)
				clearGestureTimeoutRef.current = null
			}

			// Check if this is a continuous gesture
			const isContinuousGesture = result.gesture === 'point' // Add other continuous gestures here

			if (isContinuousGesture) {
				// For continuous gestures, use flushSync to force immediate state update
				// This prevents React from batching/deferring updates
				flushSync(() => {
					setTemporalGesture(result)
				})
			} else {
				// For non-continuous gestures, normal state update is fine
				setTemporalGesture(result)

				// Clear the gesture state after a short delay so it can be detected again
				clearGestureTimeoutRef.current = window.setTimeout(() => {
					setTemporalGesture(null)
					clearGestureTimeoutRef.current = null
				}, 100)
			}
		})

		// Cleanup: unsubscribe when component unmounts
		return () => {
			unsubscribe()
			if (clearGestureTimeoutRef.current !== null) {
				clearTimeout(clearGestureTimeoutRef.current)
			}
		}
	}, [
		options.modelAssetPath,
		options.numHands,
		options.bufferSize,
		options.emaAlpha,
		options.majorityWindowSize,
		options.maxGapSize,
	])

	return {
		temporalGesture, // TemporalGestureResult | null
	}
}

/**
 * Hook to get the video stream for displaying video
 * Use this in components that need to render their own video element
 */
export function useGestureVideoStream(): MediaStream | null {
	const [stream, setStream] = useState<MediaStream | null>(null)
	const serviceRef = useRef<GestureRecognitionService | null>(null)

	useEffect(() => {
		const service = GestureRecognitionService.getInstance()
		serviceRef.current = service

		// Poll for stream availability
		const interval = setInterval(() => {
			const videoStream = service.getVideoStream()
			if (videoStream) {
				setStream(videoStream)
				clearInterval(interval)
			}
		}, 100)

		return () => clearInterval(interval)
	}, [])

	return stream
}

/**
 * Hook to check if gesture recognition is ready
 */
export function useGestureRecognitionReady(): boolean {
	const [isReady, setIsReady] = useState(false)
	const serviceRef = useRef<GestureRecognitionService | null>(null)

	useEffect(() => {
		const service = GestureRecognitionService.getInstance()
		serviceRef.current = service

		// Check readiness periodically
		const interval = setInterval(() => {
			setIsReady(service.isReady())
		}, 100)

		return () => clearInterval(interval)
	}, [])

	return isReady
}
