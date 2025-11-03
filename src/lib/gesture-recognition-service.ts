import { FilesetResolver } from '@mediapipe/tasks-vision'
import { GestureRecognizer, type GestureRecognizerResult } from '@mediapipe/tasks-vision'
import type { RefObject } from 'react'
import type {
	GestureFrameData,
	GestureFrameCallback,
	HandLandmarks,
	RecognizedGesture,
	TemporalGestureCallback,
	TemporalGestureResult,
	Landmark,
} from '@/types/gesture'

interface GestureRecognitionServiceOptions {
	modelAssetPath?: string
	numHands?: number
	bufferSize?: number
	emaAlpha?: number // EMA smoothing factor (0-1, lower = more smoothing, default: 0.3)
	majorityWindowSize?: number // Sliding majority filter window size (3 or 5, default: 3)
	maxGapSize?: number // Maximum gap size (in frames) to merge (default: 2)
}

// Type for gesture type string
type GestureType = TemporalGestureResult['gesture']

interface BufferEntry {
	wrist: Landmark | null
	palmCenter: Landmark | null
	thumbTip: Landmark | null
	indexTip: Landmark | null
	topGesture: RecognizedGesture | null
	timestamp: number
}

/**
 * Singleton service for gesture recognition
 * Handles initialization, webcam access, and frame processing once
 * Multiple hooks/components can subscribe to receive frame data
 */
class GestureRecognitionService {
	private static instance: GestureRecognitionService | null = null
	private gestureRecognizer: GestureRecognizer | null = null
	private videoRef: RefObject<HTMLVideoElement | null>
	private isInitialized = false
	private isInitializing = false
	private isProcessing = false
	private subscribers = new Set<GestureFrameCallback>()
	private temporalGestureSubscribers = new Set<TemporalGestureCallback>()
	private lastVideoTimeRef = -1
	private animationFrameRef: number | undefined
	private videoElement: HTMLVideoElement | null = null

	// Model configuration
	private modelAssetPath: string
	private numHands: number

	// Temporal gesture detection
	private buffer: BufferEntry[] = []
	private bufferSize: number
	private lastDetectedGesture: GestureType | null = null
	private currentFrameData: GestureFrameData | null = null

	// EMA smoothing state (for reducing jitter in buffer entries)
	private emaAlpha: number
	private smoothedWrist: Landmark | null = null
	private smoothedPalmCenter: Landmark | null = null
	private smoothedThumbTip: Landmark | null = null
	private smoothedIndexTip: Landmark | null = null

	// Temporal smoothing (sliding majority filter)
	private majorityWindowSize: number
	private maxGapSize: number // Maximum gap size to merge (in frames)

	private constructor(options: GestureRecognitionServiceOptions = {}) {
		this.modelAssetPath = options.modelAssetPath || '/src/assets/gesture_recognizer.task'
		this.numHands = options.numHands || 2
		this.bufferSize = options.bufferSize || 30
		this.emaAlpha = options.emaAlpha !== undefined ? options.emaAlpha : 0.3
		this.majorityWindowSize = options.majorityWindowSize || 5
		this.maxGapSize = options.maxGapSize !== undefined ? options.maxGapSize : 2

		this.videoRef = { current: null } as RefObject<HTMLVideoElement | null>
	}

	/**
	 * Get the singleton instance
	 */
	static getInstance(options: GestureRecognitionServiceOptions = {}): GestureRecognitionService {
		if (!GestureRecognitionService.instance) {
			GestureRecognitionService.instance = new GestureRecognitionService(options)
		}
		return GestureRecognitionService.instance
	}

	/**
	 * Subscribe to frame data updates (for rendering)
	 * Returns unsubscribe function
	 */
	subscribe(callback: GestureFrameCallback): () => void {
		this.subscribers.add(callback)

		// Initialize if not already initialized
		if (!this.isInitialized && !this.isInitializing) {
			this.initialize()
		}

		// Return unsubscribe function
		return () => {
			this.subscribers.delete(callback)
		}
	}

	/**
	 * Subscribe to temporal gesture events (only emitted when detected)
	 * Returns unsubscribe function
	 */
	subscribeToTemporalGestures(callback: TemporalGestureCallback): () => void {
		this.temporalGestureSubscribers.add(callback)

		// Initialize if not already initialized
		if (!this.isInitialized && !this.isInitializing) {
			this.initialize()
		}

		// Return unsubscribe function
		return () => {
			this.temporalGestureSubscribers.delete(callback)
		}
	}

	/**
	 * Get current frame data (for rendering without React state)
	 */
	getCurrentFrameData(): GestureFrameData | null {
		return this.currentFrameData
	}

	/**
	 * Update temporal gesture detection options
	 */
	updateTemporalGestureOptions(options: {
		bufferSize?: number
		emaAlpha?: number
		majorityWindowSize?: number
		maxGapSize?: number
	}) {
		if (options.bufferSize !== undefined) {
			this.bufferSize = options.bufferSize
		}
		if (options.emaAlpha !== undefined) {
			this.emaAlpha = options.emaAlpha
		}
		if (options.majorityWindowSize !== undefined) {
			this.majorityWindowSize = options.majorityWindowSize
		}
		if (options.maxGapSize !== undefined) {
			this.maxGapSize = options.maxGapSize
		}
	}

	/**
	 * Get the video ref for components that want to display video
	 */
	getVideoRef(): RefObject<HTMLVideoElement | null> {
		return this.videoRef
	}

	/**
	 * Get the current video element
	 */
	getVideoElement(): HTMLVideoElement | null {
		return this.videoRef.current || this.videoElement
	}

	/**
	 * Get the video stream for use in other video elements
	 */
	getVideoStream(): MediaStream | null {
		const video = this.videoRef.current || this.videoElement
		if (video && video.srcObject) {
			return video.srcObject as MediaStream
		}
		return null
	}

	/**
	 * Check if service is ready
	 */
	isReady(): boolean {
		return this.isInitialized && this.isProcessing
	}

	/**
	 * Initialize the gesture recognizer and access webcam
	 */
	private async initialize() {
		if (this.isInitialized || this.isInitializing) return

		this.isInitializing = true

		try {
			// Initialize MediaPipe GestureRecognizer
			const vision = await FilesetResolver.forVisionTasks(
				'/node_modules/@mediapipe/tasks-vision/wasm'
			)
			const recognizer = await GestureRecognizer.createFromOptions(vision, {
				baseOptions: {
					modelAssetPath: this.modelAssetPath,
				},
				numHands: this.numHands,
			})

			// Set to video mode
			await recognizer.setOptions({ runningMode: 'VIDEO' })

			this.gestureRecognizer = recognizer

			// Access webcam
			await this.accessWebcam()

			this.isInitialized = true
			this.isInitializing = false
		} catch (error) {
			console.error('Error initializing gesture recognition service:', error)
			this.isInitializing = false
		}
	}

	/**
	 * Access webcam and start processing
	 */
	private async accessWebcam() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'user' },
			})

			// Create video element if it doesn't exist
			if (!this.videoRef.current) {
				const video = document.createElement('video')
				video.playsInline = true
				video.muted = true
				video.autoplay = true
				video.style.display = 'none' // Hide the service's video element
				document.body.appendChild(video)
				this.videoElement = video
				this.videoRef.current = video
			}

			const video = this.videoRef.current
			video.srcObject = stream

			// Wait for video metadata before playing
			await new Promise<void>((resolve) => {
				video.addEventListener(
					'loadedmetadata',
					async () => {
						try {
							await video.play()
							resolve()
						} catch (error) {
							// Ignore play() interruption errors
							if (error instanceof Error && error.name !== 'AbortError') {
								console.error('Error playing video:', error)
							}
							resolve()
						}
					},
					{ once: true }
				)
			})

			// Start processing loop
			if (this.gestureRecognizer) {
				this.startProcessing()
			}
		} catch (error) {
			console.error('Error accessing webcam:', error)
		}
	}

	/**
	 * Apply EMA (Exponential Moving Average) smoothing to a landmark
	 */
	private applyEMA(current: Landmark | null, previous: Landmark | null): Landmark | null {
		if (!current) return null
		if (!previous) return current

		return {
			x: this.emaAlpha * current.x + (1 - this.emaAlpha) * previous.x,
			y: this.emaAlpha * current.y + (1 - this.emaAlpha) * previous.y,
			z:
				current.z !== undefined && previous.z !== undefined
					? this.emaAlpha * current.z + (1 - this.emaAlpha) * previous.z
					: current.z,
		}
	}

	/**
	 * Compute reference points from landmarks
	 */
	private computeReferencePoints(landmarks: HandLandmarks): BufferEntry {
		const getPoint = (index: number) => (landmarks[index] || null) as Landmark | null

		// Wrist
		const wrist = getPoint(0)

		// Palm center (average of wrist and finger bases)
		let palmCenter: Landmark | null = null
		if (wrist) {
			const bases = [
				getPoint(0),
				getPoint(5),
				getPoint(9),
				getPoint(13),
				getPoint(17),
			].filter((p): p is Landmark => p !== null)
			if (bases.length > 0) {
				const sum = bases.reduce(
					(acc, p) => ({
						x: acc.x + p.x,
						y: acc.y + p.y,
						z: (acc.z || 0) + (p.z || 0),
					}),
					{ x: 0, y: 0, z: 0 }
				)
				palmCenter = {
					x: sum.x / bases.length,
					y: sum.y / bases.length,
					z: sum.z ? sum.z / bases.length : undefined,
				}
			}
		}

		return {
			wrist,
			palmCenter,
			thumbTip: getPoint(4),
			indexTip: getPoint(8),
			topGesture: null,
			timestamp: 0,
		}
	}

	/**
	 * Apply sliding majority filter to smooth gesture labels temporally
	 * Returns array of smoothed labels with confidence scores
	 */
	private applySlidingMajorityFilter(buffer: BufferEntry[]): Array<{
		label: string | null
		confidence: number
	}> {
		const len = buffer.length
		if (len === 0) return []

		const window = this.majorityWindowSize
		const halfWindow = Math.floor(window / 2)
		const smoothedLabels: Array<{ label: string | null; confidence: number }> = []

		for (let i = 0; i < len; i++) {
			// Define window bounds
			const start = Math.max(0, i - halfWindow)
			const end = Math.min(len - 1, i + halfWindow)
			const windowSize = end - start + 1

			// Count labels in window
			const labelCounts: Map<string, number> = new Map()
			const labelScores: Map<string, number[]> = new Map()

			for (let j = start; j <= end; j++) {
				const label = buffer[j].topGesture?.categoryName || 'None'
				const score = buffer[j].topGesture?.score || 0

				labelCounts.set(label, (labelCounts.get(label) || 0) + 1)
				if (!labelScores.has(label)) {
					labelScores.set(label, [])
				}
				labelScores.get(label)!.push(score)
			}

			// Find majority label
			let majorityLabel: string | null = null
			let maxCount = 0
			const tieLabels: string[] = []

			for (const [label, count] of labelCounts.entries()) {
				if (count > maxCount) {
					maxCount = count
					majorityLabel = label
					tieLabels.length = 0
					tieLabels.push(label)
				} else if (count === maxCount) {
					tieLabels.push(label)
				}
			}

			// Handle ties: prefer non-None label, or higher average score
			if (tieLabels.length > 1) {
				const nonNoneLabels = tieLabels.filter((l) => l !== 'None')
				if (nonNoneLabels.length > 0) {
					// Choose label with highest average score among ties
					let bestLabel = nonNoneLabels[0]
					let bestAvgScore = 0

					for (const label of nonNoneLabels) {
						const scores = labelScores.get(label) || []
						const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
						if (avgScore > bestAvgScore) {
							bestAvgScore = avgScore
							bestLabel = label
						}
					}
					majorityLabel = bestLabel
				} else {
					// All are None, choose first
					majorityLabel = tieLabels[0]
				}
			}

			// Normalize: if majorityLabel is 'None', convert to null
			const finalLabel = majorityLabel === 'None' ? null : majorityLabel

			// Compute confidence (fraction of window frames that equal the chosen label)
			const confidence = maxCount / windowSize

			smoothedLabels.push({ label: finalLabel, confidence })
		}

		return smoothedLabels
	}

	/**
	 * Compress smoothed labels into consecutive blocks/runs
	 * Returns array of blocks with gesture, start, and end indices
	 */
	private compressSmoothedLabelsToBlocks(
		smoothedLabels: Array<{ label: string | null; confidence: number }>
	): Array<{ gesture: string | null; start: number; end: number }> {
		if (smoothedLabels.length === 0) return []

		const blocks: Array<{ gesture: string | null; start: number; end: number }> = []
		let currentGesture: string | null = smoothedLabels[0]?.label ?? null
		let startIndex = 0

		for (let i = 1; i < smoothedLabels.length; i++) {
			const label = smoothedLabels[i]?.label ?? null

			// If gesture changes, save the previous block and start a new one
			if (label !== currentGesture) {
				// Save previous block
				blocks.push({
					gesture: currentGesture,
					start: startIndex,
					end: i - 1,
				})

				// Start new block
				currentGesture = label
				startIndex = i
			}
		}

		// Don't forget the last block
		if (smoothedLabels.length > 0) {
			blocks.push({
				gesture: currentGesture,
				start: startIndex,
				end: smoothedLabels.length - 1,
			})
		}

		return blocks
	}

	/**
	 * Post-process blocks to merge tiny gaps (small None/null blocks)
	 * Removes small transient None blocks and merges them with adjacent non-None blocks
	 */
	private mergeTinyGaps(
		blocks: Array<{ gesture: string | null; start: number; end: number }>
	): Array<{ gesture: string | null; start: number; end: number }> {
		if (blocks.length === 0) return []

		const merged: Array<{ gesture: string | null; start: number; end: number }> = []

		for (let i = 0; i < blocks.length; i++) {
			const currentBlock = blocks[i]
			const blockLength = currentBlock.end - currentBlock.start + 1

			// If it's a None/null block and is small enough to merge
			if (
				(currentBlock.gesture === null || currentBlock.gesture === 'None') &&
				blockLength <= this.maxGapSize
			) {
				// Helper to check if a gesture is non-None
				const isNonNone = (gesture: string | null) => gesture !== null && gesture !== 'None'

				// Try to merge with previous non-None block
				if (merged.length > 0 && isNonNone(merged[merged.length - 1].gesture)) {
					// Merge with previous block by extending its end
					merged[merged.length - 1].end = currentBlock.end
					continue
				}

				// If no previous non-None block, try to merge with next non-None block
				if (i + 1 < blocks.length && isNonNone(blocks[i + 1].gesture)) {
					// Merge with next block by extending its start
					const nextBlock = { ...blocks[i + 1] }
					nextBlock.start = currentBlock.start
					merged.push(nextBlock)
					i++ // Skip the next block since we've merged it
					continue
				}

				// If surrounded by None blocks or at edges, skip this tiny gap
				// (effectively removing it)
				continue
			}

			// Keep non-None blocks and larger None blocks
			merged.push({ ...currentBlock })
		}

		return merged
	}

	/**
	 * Merge consecutive blocks with the same gesture
	 * This handles cases where the same gesture appears in multiple consecutive blocks
	 */
	private mergeConsecutiveSameGestures(
		blocks: Array<{ gesture: string | null; start: number; end: number }>
	): Array<{ gesture: string | null; start: number; end: number }> {
		if (blocks.length === 0) return []

		const merged: Array<{ gesture: string | null; start: number; end: number }> = []
		let currentBlock = { ...blocks[0] }

		for (let i = 1; i < blocks.length; i++) {
			const nextBlock = blocks[i]

			// Normalize gestures for comparison (treat null and 'None' as the same)
			const currentGesture = currentBlock.gesture === 'None' ? null : currentBlock.gesture
			const nextGesture = nextBlock.gesture === 'None' ? null : nextBlock.gesture

			// If gestures match, merge them by extending the end
			if (currentGesture === nextGesture) {
				currentBlock.end = nextBlock.end
			} else {
				// Different gesture - save current block and start new one
				merged.push(currentBlock)
				currentBlock = { ...nextBlock }
			}
		}

		// Don't forget the last block
		merged.push(currentBlock)

		return merged
	}

	/**
	 * Check if blocks match a gesture sequence at the end
	 * Returns true if the last N blocks match the sequence exactly, false otherwise
	 * The sequence must be at the very end (no blocks after it)
	 *
	 * @param blocks Array of gesture blocks
	 * @param sequence Array of gesture names to match (e.g., ["Open_Palm", "Closed_Fist"])
	 * @returns true if the sequence matches at the end, false otherwise
	 *
	 * @example
	 * ```ts
	 * const blocks = [
	 *   {gesture: null, start: 0, end: 5},
	 *   {gesture: "Open_Palm", start: 6, end: 12},
	 *   {gesture: "Closed_Fist", start: 12, end: 17},
	 * ]
	 * matchGestureSequence(blocks, ["Open_Palm", "Closed_Fist"]) // returns true
	 * ```
	 */
	private matchGestureSequence(
		blocks: Array<{ gesture: string | null; start: number; end: number }>,
		sequence: (string | null)[]
	): boolean {
		if (blocks.length === 0 || sequence.length === 0) return false
		if (blocks.length < sequence.length) return false

		// Iterate backwards: compare the last block with the last sequence item, working backwards
		// This makes the "at the end" constraint more explicit and clear
		for (let i = sequence.length - 1; i >= 0; i--) {
			const blockIndex = blocks.length - (sequence.length - i)
			const blockGesture = blocks[blockIndex]?.gesture
			const expectedGesture = sequence[i]

			// Normalize: treat null and 'None' as the same
			const blockNormalized = blockGesture === 'None' ? null : blockGesture
			const expectedNormalized = expectedGesture === 'None' ? null : expectedGesture

			if (blockNormalized !== expectedNormalized) {
				return false
			}
		}

		// All gestures match at the end
		return true
	}

	/**
	 * Detect temporal gestures from buffer using smoothed labels
	 */
	private detectTemporalGesture(buffer: BufferEntry[]): TemporalGestureResult | null {
		if (buffer.length === 0) return null

		// For other gestures, use full buffer processing pipeline
		// Apply sliding majority filter to get smoothed labels
		const smoothedLabels = this.applySlidingMajorityFilter(buffer)

		// Compress smoothed labels into blocks
		let blocks = this.compressSmoothedLabelsToBlocks(smoothedLabels)

		// Post-process: merge tiny gaps
		blocks = this.mergeTinyGaps(blocks)

		// Post-process: merge consecutive blocks with the same gesture
		blocks = this.mergeConsecutiveSameGestures(blocks)

		// Swipe detection gesture sequence
		if (this.matchGestureSequence(blocks, ['Open_Palm', 'Closed_Fist'])) {
			const closedFistStartIndex = blocks[blocks.length - 1].start
			const firstPalmCenter = buffer[closedFistStartIndex].palmCenter
			const lastPalmCenter = buffer[buffer.length - 1].palmCenter

			if (firstPalmCenter && lastPalmCenter) {
				const deltaX = lastPalmCenter.x - firstPalmCenter.x
				if (deltaX > 0.1) {
					return { gesture: 'swipe_left' }
				} else if (deltaX < -0.1) {
					return { gesture: 'swipe_right' }
				}
			}
		}

		// Click detection gesture sequence
		if (this.matchGestureSequence(blocks, ['Pointing_Up', 'Closed_Fist', 'Pointing_Up'])) {
			// console.log('click detected!', blocks.slice(-3))
			return { gesture: 'click' }
		}

		return null
	}

	/**
	 * Process frames and notify subscribers
	 */
	private processResult(result: GestureRecognizerResult): GestureFrameData {
		const landmarks: HandLandmarks[] = result.landmarks || []

		// Extract gestures - flatten and extract top gestures per hand
		const gestures: RecognizedGesture[] = []
		let topGesture: RecognizedGesture | null = null

		if (result.gestures && result.gestures.length > 0) {
			// Process gestures for each hand
			result.gestures.forEach((handGestures) => {
				if (handGestures && handGestures.length > 0) {
					const top = handGestures[0]
					gestures.push({
						categoryName: top.categoryName,
						score: top.score,
					})
					// Keep track of the most confident gesture across all hands
					if (!topGesture || top.score > topGesture.score) {
						topGesture = {
							categoryName: top.categoryName,
							score: top.score,
						}
					}
				}
			})
		}

		const frameData: GestureFrameData = {
			result: {
				landmarks,
				gestures: result.gestures || [],
			},
			landmarks,
			gestures,
			topGesture,
			timestamp: performance.now(),
		}

		// Update current frame data for rendering
		this.currentFrameData = frameData

		// Process temporal gesture detection (outside React lifecycle)
		this.processTemporalGestureDetection(frameData)

		return frameData
	}

	/**
	 * Process temporal gesture detection internally (outside React lifecycle)
	 */
	private processTemporalGestureDetection(frameData: GestureFrameData): void {
		// Compute reference points from first hand
		const landmarks = frameData.landmarks?.[0] || []
		const refPoints = this.computeReferencePoints(landmarks)

		// Apply EMA smoothing to reduce jitter
		const smoothedWrist = this.applyEMA(refPoints.wrist, this.smoothedWrist)
		const smoothedPalmCenter = this.applyEMA(refPoints.palmCenter, this.smoothedPalmCenter)
		const smoothedThumbTip = this.applyEMA(refPoints.thumbTip, this.smoothedThumbTip)
		const smoothedIndexTip = this.applyEMA(refPoints.indexTip, this.smoothedIndexTip)

		// Update smoothed state for next iteration
		this.smoothedWrist = smoothedWrist
		this.smoothedPalmCenter = smoothedPalmCenter
		this.smoothedThumbTip = smoothedThumbTip
		this.smoothedIndexTip = smoothedIndexTip

		// For point gesture, emit immediately from current frame (bypass buffer for real-time tracking)
		const isPointing =
			frameData.topGesture?.categoryName === 'Pointing_Up' && smoothedPalmCenter

		if (isPointing) {
			const pointGesture: TemporalGestureResult = {
				gesture: 'point',
				x: smoothedPalmCenter.x,
				y: smoothedPalmCenter.y - 0.3,
			}

			// Emit immediately - no delays, no buffering
			this.temporalGestureSubscribers.forEach((callback) => {
				try {
					callback(pointGesture)
				} catch (error) {
					console.error('Error in temporal gesture callback:', error)
				}
			})

			this.lastDetectedGesture = 'point'
		} else if (this.lastDetectedGesture === 'point') {
			// We were pointing but now we're not - clear the gesture
			this.lastDetectedGesture = null
		}

		// Always add to buffer (needed for other gesture detection and point gesture when not actively pointing)
		// Create buffer entry with smoothed values

		// Create buffer entry with smoothed values (excluding topGesture and timestamp from smoothing)
		const entry: BufferEntry = {
			wrist: smoothedWrist,
			palmCenter: smoothedPalmCenter,
			thumbTip: smoothedThumbTip,
			indexTip: smoothedIndexTip,
			topGesture: frameData.topGesture,
			timestamp: frameData.timestamp,
		}

		// Add to buffer and maintain size
		this.buffer.push(entry)
		if (this.buffer.length > this.bufferSize) {
			this.buffer.shift()
		}

		// Detect gestures (for non-point gestures or when not pointing)
		const detectedGesture = this.detectTemporalGesture(this.buffer)

		if (detectedGesture) {
			const gestureType = detectedGesture.gesture

			// Emit the gesture
			this.temporalGestureSubscribers.forEach((callback) => {
				try {
					callback(detectedGesture)
				} catch (error) {
					console.error('Error in temporal gesture callback:', error)
				}
			})

			// Clear buffer after emitting gesture (except point which is continuous)
			// This prevents duplicate detections from stale buffer data
			// The natural delay from performing the gesture sequence again provides sufficient debouncing
			if (gestureType !== 'point') {
				this.buffer = []
			}
		}
	}

	/**
	 * Start the processing loop
	 */
	private startProcessing() {
		if (this.isProcessing) return
		this.isProcessing = true

		const processFrame = () => {
			const video = this.videoRef.current
			const recognizer = this.gestureRecognizer

			if (!video || !recognizer || !this.isProcessing) {
				this.isProcessing = false
				return
			}

			// Run inference when video time changes (new frame available)
			if (video.currentTime !== this.lastVideoTimeRef) {
				// Run inference
				const gestureRecognitionResult = recognizer.recognizeForVideo(
					video,
					performance.now()
				)

				// Process the result (handles buffer and temporal detection internally)
				const frameData = this.processResult(gestureRecognitionResult)

				// Notify frame data subscribers (for rendering - optional, can use getCurrentFrameData instead)
				this.subscribers.forEach((callback) => {
					try {
						callback(frameData)
					} catch (error) {
						console.error('Error in gesture frame callback:', error)
					}
				})

				this.lastVideoTimeRef = video.currentTime
			}

			this.animationFrameRef = requestAnimationFrame(processFrame)
		}

		processFrame()
	}

	/**
	 * Stop processing and cleanup
	 */
	destroy() {
		this.isProcessing = false

		if (this.animationFrameRef !== undefined) {
			cancelAnimationFrame(this.animationFrameRef)
		}

		if (this.videoRef.current?.srcObject) {
			const stream = this.videoRef.current.srcObject as MediaStream
			stream.getTracks().forEach((track) => track.stop())
		}

		if (this.videoElement && this.videoElement.parentNode) {
			this.videoElement.parentNode.removeChild(this.videoElement)
		}

		this.subscribers.clear()
		this.temporalGestureSubscribers.clear()
		this.buffer = []
		this.currentFrameData = null
		GestureRecognitionService.instance = null
	}
}

export default GestureRecognitionService
