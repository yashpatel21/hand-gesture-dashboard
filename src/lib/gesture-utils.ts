import type { HandLandmarks, Landmark } from '@/types/gesture'

// Hand landmark connections (skeleton structure)
export const HAND_CONNECTIONS = [
	[0, 1],
	[1, 2],
	[2, 3],
	[3, 4], // Thumb
	[0, 5],
	[5, 6],
	[6, 7],
	[7, 8], // Index finger
	[0, 9],
	[9, 10],
	[10, 11],
	[11, 12], // Middle finger
	[0, 13],
	[13, 14],
	[14, 15],
	[15, 16], // Ring finger
	[0, 17],
	[17, 18],
	[18, 19],
	[19, 20], // Pinky
	[5, 9],
	[9, 13],
	[13, 17], // Palm connections
]

/**
 * Draws hand landmarks on a canvas overlay
 */
export function drawLandmarks(
	landmarks: HandLandmarks[],
	canvas: HTMLCanvasElement,
	video: HTMLVideoElement
): void {
	const ctx = canvas.getContext('2d')
	if (!ctx) return

	// Clear canvas
	ctx.clearRect(0, 0, canvas.width, canvas.height)

	// Set canvas size to match video
	if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
		canvas.width = video.videoWidth
		canvas.height = video.videoHeight
	}

	if (!landmarks || landmarks.length === 0) return

	// Draw landmarks for each hand
	landmarks.forEach((handLandmarks) => {
		if (!handLandmarks || handLandmarks.length === 0) return

		// Draw connections (skeleton)
		ctx.strokeStyle = '#00FF00'
		ctx.lineWidth = 1.5
		HAND_CONNECTIONS.forEach(([start, end]) => {
			if (handLandmarks[start] && handLandmarks[end]) {
				const startPoint = handLandmarks[start]
				const endPoint = handLandmarks[end]
				ctx.beginPath()
				ctx.moveTo(startPoint.x * canvas.width, startPoint.y * canvas.height)
				ctx.lineTo(endPoint.x * canvas.width, endPoint.y * canvas.height)
				ctx.stroke()
			}
		})

		// Draw landmarks (joints)
		ctx.fillStyle = '#FF0000'
		handLandmarks.forEach((landmark: Landmark) => {
			if (landmark) {
				ctx.beginPath()
				ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 2.5, 0, 2 * Math.PI)
				ctx.fill()
			}
		})
	})
}

/**
 * Clears the landmarks canvas
 */
export function clearLandmarks(canvas: HTMLCanvasElement): void {
	const ctx = canvas.getContext('2d')
	if (ctx) {
		ctx.clearRect(0, 0, canvas.width, canvas.height)
	}
}
