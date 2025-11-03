// Types for MediaPipe landmark
export interface Landmark {
	x: number
	y: number
	z?: number
}

// Type for hand landmarks array
export type HandLandmarks = Landmark[]

// Recognized gesture information
export interface RecognizedGesture {
	categoryName: string
	score: number
}

// Frame data that gets passed to callbacks on each frame
export interface GestureFrameData {
	// Raw MediaPipe result
	result: {
		landmarks: HandLandmarks[]
		gestures: RecognizedGesture[][]
	}
	// Processed data for easier access
	landmarks: HandLandmarks[]
	gestures: RecognizedGesture[]
	// Top gesture (most confident)
	topGesture: RecognizedGesture | null
	// Timestamp of the frame
	timestamp: number
}

// Callback function type for receiving frame data
export type GestureFrameCallback = (data: GestureFrameData) => void

// Temporal gesture detection result - discriminated union based on gesture type
export type TemporalGestureResult =
	| { gesture: 'swipe_left' }
	| { gesture: 'swipe_right' }
	| { gesture: 'click' }
	| { gesture: 'point'; x: number | undefined; y: number | undefined }

// Callback function type for temporal gesture events
export type TemporalGestureCallback = (result: TemporalGestureResult) => void
