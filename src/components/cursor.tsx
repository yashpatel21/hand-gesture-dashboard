import { useEffect, useState, useRef } from 'react'
import type { TemporalGestureResult } from '@/types/gesture'
import GestureRecognitionService from '@/lib/gesture-recognition-service'

interface CursorProps {
	temporalGesture: TemporalGestureResult | null
}

/**
 * Cursor component that follows the point gesture
 * Displays a circle that moves around the screen based on normalized coordinates (0-1)
 * Uses fast interpolation for smooth movement with minimal latency
 */
function Cursor({ temporalGesture }: CursorProps) {
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
	const targetPositionRef = useRef<{ x: number; y: number } | null>(null)
	const currentPositionRef = useRef<{ x: number; y: number } | null>(null)
	const animationFrameRef = useRef<number | null>(null)
	const lastClickTimeRef = useRef<number>(0)
	const cursorElementRef = useRef<HTMLDivElement>(null)
	const pendingClickElementRef = useRef<Element | null>(null) // Track the element to click when click gesture is detected
	const highlightedElementRef = useRef<Element | null>(null) // Track currently highlighted element
	const lastPointingUpTimeRef = useRef<number | null>(null) // Track when Pointing_Up was last detected
	const isVisibleRef = useRef<boolean>(true) // Track if cursor should be visible
	const currentlySnappedElementRef = useRef<Element | null>(null) // Track currently snapped element

	// Snapping configuration
	const SNAP_THRESHOLD = 75 // Distance in pixels to snap to an element
	const SNAP_TO_DIFFERENT_THRESHOLD = 20 // Distance in pixels to snap to a different element when already snapped (much more restrictive)
	const SNAP_DIFFERENCE_RATIO = 0.1 // New element must be at least 40% closer than current to switch
	const HIDE_AFTER_NO_POINTING_MS = 2000 // Hide cursor after 2 seconds of no Pointing_Up gesture

	// Helper function to find the open dialog element
	const getOpenDialog = (): Element | null => {
		// Check for Radix UI dialog with data-state="open"
		const dialogContent = document.querySelector(
			'[data-slot="dialog-content"][data-state="open"]'
		)
		if (dialogContent) {
			return dialogContent
		}
		// Fallback: check for any element with data-state="open" that looks like a dialog
		const openDialogs = document.querySelectorAll('[data-state="open"]')
		for (const dialog of openDialogs) {
			// Check if it has dialog-related attributes
			if (
				dialog.hasAttribute('data-slot') &&
				(dialog.getAttribute('data-slot')?.includes('dialog') ||
					dialog.classList.contains('dialog') ||
					dialog.querySelector('[data-slot="dialog-content"]'))
			) {
				return dialog
			}
		}
		return null
	}

	// Helper function to check if an element is a descendant of the dialog
	const isElementInDialog = (element: Element, dialog: Element): boolean => {
		let current: Element | null = element
		while (current) {
			if (current === dialog) {
				return true
			}
			current = current.parentElement
		}
		return false
	}

	// Helper function to calculate distance between a circle (cursor) and a rectangle (element)
	const distanceBetweenCircleAndRect = (
		cx: number,
		cy: number,
		rect: DOMRect
	): { distance: number; closestPoint: { x: number; y: number } } => {
		const x1 = rect.left // top-left x
		const y1 = rect.top // top-left y
		const x2 = rect.left + rect.width // bottom-right x
		const y2 = rect.top + rect.height // bottom-right y

		// Clamp circle center to rectangle boundaries
		const closestX = Math.max(x1, Math.min(cx, x2))
		const closestY = Math.max(y1, Math.min(cy, y2))

		// Distance from circle center to that closest point
		const dx = cx - closestX
		const dy = cy - closestY
		const distance = Math.sqrt(dx * dx + dy * dy)

		return { distance, closestPoint: { x: closestX, y: closestY } }
	}

	// Update target position from gesture data
	// Use a ref to track the latest gesture without causing re-renders
	const latestGestureRef = useRef<TemporalGestureResult | null>(null)

	useEffect(() => {
		latestGestureRef.current = temporalGesture

		// Handle click gesture immediately when detected
		if (temporalGesture?.gesture === 'click') {
			// Find the element under the cursor at the moment click is detected
			// Use the current cursor position from currentPositionRef
			if (currentPositionRef.current) {
				const x = Math.round(currentPositionRef.current.x)
				const y = Math.round(currentPositionRef.current.y)

				// Helper function to check if element is interactive
				const isInteractiveElement = (el: Element): boolean => {
					if (
						el.tagName === 'BODY' ||
						el.tagName === 'HTML' ||
						el.id === 'root' ||
						el === document.body ||
						el === document.documentElement
					) {
						return false
					}
					const tagName = el.tagName.toLowerCase()
					const role = el.getAttribute('role')
					return (
						tagName === 'button' ||
						tagName === 'a' ||
						tagName === 'input' ||
						tagName === 'select' ||
						tagName === 'textarea' ||
						role === 'button' ||
						role === 'link' ||
						role === 'menuitem' ||
						role === 'tab' ||
						role === 'textbox'
					)
				}

				// Temporarily hide cursor to find element underneath
				const cursorElement = cursorElementRef.current
				if (cursorElement) {
					cursorElement.style.display = 'none'
				}

				// Check if a dialog is open
				const openDialog = getOpenDialog()

				// Find element under cursor
				let element: Element | null = null
				if (document.elementsFromPoint) {
					const elements = document.elementsFromPoint(x, y)
					let filteredElements = elements.filter((el) => el !== cursorElement)

					// If a dialog is open, only consider elements inside the dialog
					if (openDialog) {
						filteredElements = filteredElements.filter((el) =>
							isElementInDialog(el, openDialog)
						)
					}

					// First, try to find an element with "interactive" class
					const interactiveClassElements = filteredElements.filter((el) =>
						el.classList.contains('interactive')
					)
					if (interactiveClassElements.length > 0) {
						element = interactiveClassElements[0]
					} else {
						// Fallback to checking if it's an interactive element type
						const interactiveTypeElements = filteredElements.filter((el) =>
							isInteractiveElement(el)
						)
						element =
							interactiveTypeElements.length > 0 ? interactiveTypeElements[0] : null
					}
				} else {
					const foundElement = document.elementFromPoint(x, y)
					if (
						foundElement &&
						foundElement !== cursorElement &&
						!(openDialog && !isElementInDialog(foundElement, openDialog)) &&
						(foundElement.classList.contains('interactive') ||
							isInteractiveElement(foundElement))
					) {
						element = foundElement
					}
				}

				// Restore cursor visibility
				if (cursorElement) {
					cursorElement.style.display = 'block'
				}

				// Store the element to click if it's interactive
				pendingClickElementRef.current = element
			}
			return // Don't process as point gesture
		}

		if (temporalGesture?.gesture === 'point') {
			const { x, y } = temporalGesture

			// Convert normalized coordinates (0-1) to screen pixels
			if (x !== undefined && y !== undefined) {
				// Mapping range configuration (easy to update)
				const minX = 0.3
				const maxX = 0.7
				const minY = 0.2
				const maxY = 0.6
				const rangeX = maxX - minX
				const rangeY = maxY - minY

				// Helper function to map value from [min, max] to [0, 1]
				const mapToScreenX = (value: number) => {
					if (value < minX) return 0
					if (value > maxX) return 1
					return (value - minX) / rangeX
				}

				const mapToScreenY = (value: number) => {
					if (value < minY) return 0
					if (value > maxY) return 1
					return (value - minY) / rangeY
				}

				// For x: first invert (1 - x) since camera is inverted, then map
				// For y: map directly
				const invertedX = 1 - x
				const mappedX = mapToScreenX(invertedX)
				const mappedY = mapToScreenY(y)

				// Clamp values to prevent drift and ensure valid coordinates
				const clampedX = Math.max(0, Math.min(1, mappedX))
				const clampedY = Math.max(0, Math.min(1, mappedY))

				// Calculate target position using current window size
				targetPositionRef.current = {
					x: clampedX * window.innerWidth,
					y: clampedY * window.innerHeight,
				}
			}
		} else {
			// Hide cursor when not pointing
			// Don't cancel animation frame - let the loop continue running
			// The loop will handle null targetPosition by setting position to null
			targetPositionRef.current = null

			// Remove highlight when cursor is hidden
			if (highlightedElementRef.current) {
				highlightedElementRef.current.classList.remove('highlighted')
				highlightedElementRef.current = null
			}
		}
	}, [temporalGesture])

	// Smooth cursor updates and click detection using requestAnimationFrame
	// This effect runs once and creates a stable animation loop
	// It doesn't restart when temporalGesture changes - uses ref instead
	useEffect(() => {
		let isRunning = true

		const animate = () => {
			if (!isRunning) return

			// Check visibility: hide cursor if no hand detected or no Pointing_Up for too long
			const service = GestureRecognitionService.getInstance()
			const frameData = service.getCurrentFrameData()
			const currentTopGesture = frameData?.topGesture?.categoryName || null
			const now = performance.now()

			// Update last Pointing_Up time if currently detecting it
			if (currentTopGesture === 'Pointing_Up') {
				lastPointingUpTimeRef.current = now
				if (!isVisibleRef.current) {
					// Show cursor again when Pointing_Up is detected
					isVisibleRef.current = true
				}
			}

			// Check if we should hide the cursor
			let shouldHide = false
			if (currentTopGesture === null || currentTopGesture === undefined) {
				// No hand detected
				shouldHide = true
			} else if (lastPointingUpTimeRef.current !== null) {
				// Check if it's been too long since last Pointing_Up
				const timeSinceLastPointing = now - lastPointingUpTimeRef.current
				if (timeSinceLastPointing > HIDE_AFTER_NO_POINTING_MS) {
					shouldHide = true
				}
			}

			if (shouldHide) {
				isVisibleRef.current = false
				currentPositionRef.current = null
				setPosition(null)
				const cursorElement = cursorElementRef.current
				if (cursorElement) {
					cursorElement.style.opacity = '0'
				}
				animationFrameRef.current = requestAnimationFrame(animate)
				return
			}

			if (targetPositionRef.current === null || !isVisibleRef.current) {
				currentPositionRef.current = null
				setPosition(null)
				animationFrameRef.current = requestAnimationFrame(animate)
				return
			}
			const target = targetPositionRef.current
			if (target === null) {
				setPosition(null)
				return
			}

			// Simplified snapping: find closest interactive element and snap directly to its center
			// Get cursor element once at the start
			const cursorElement = cursorElementRef.current

			// Check if a dialog is open
			const openDialog = getOpenDialog()

			// Find all interactive elements
			let interactiveElements = Array.from(document.querySelectorAll('.interactive')).filter(
				(el) => el !== cursorElement
			)

			// If a dialog is open, only consider elements inside the dialog
			if (openDialog) {
				interactiveElements = interactiveElements.filter((el) =>
					isElementInDialog(el, openDialog)
				)
			}

			// Smart snapping with lerping: find closest interactive element and snap to its center
			// Use hysteresis when already snapped to prevent jittery switching between elements
			let snappedTarget = target
			let isSnapping = false

			if (interactiveElements.length > 0) {
				const currentlySnapped = currentlySnappedElementRef.current
				let closestDistance = Infinity
				let closestCenter: { x: number; y: number } | null = null
				let closestElement: Element | null = null

				// Find closest element within threshold
				for (const el of interactiveElements) {
					// Skip hidden elements
					if (el instanceof HTMLElement) {
						const style = window.getComputedStyle(el)
						if (
							style.display === 'none' ||
							style.visibility === 'hidden' ||
							style.opacity === '0'
						) {
							continue
						}
					}

					const rect = el.getBoundingClientRect()
					if (rect.width === 0 || rect.height === 0) {
						continue
					}

					// Calculate distance from cursor to element's bounding box (not just center)
					const { distance } = distanceBetweenCircleAndRect(target.x, target.y, rect)

					// Calculate element center for snapping target
					const centerX = rect.left + rect.width / 2
					const centerY = rect.top + rect.height / 2

					// Determine which threshold to use based on whether we're already snapped
					let threshold = SNAP_THRESHOLD
					let effectiveDistance = distance // For comparison, may adjust for hysteresis

					if (currentlySnapped) {
						if (el === currentlySnapped) {
							// Same element we're already snapped to: use normal threshold
							threshold = SNAP_THRESHOLD
							// Give it a significant "bonus" in comparison by reducing effective distance
							// This makes it much harder to switch away (even if another element is closer)
							effectiveDistance = distance * 0.5 // 50% closer for comparison (stronger hysteresis)
						} else {
							// Different element: require much closer distance and be significantly closer
							threshold = SNAP_TO_DIFFERENT_THRESHOLD

							// Calculate distance to currently snapped element's bounding box for comparison
							const currentRect = currentlySnapped.getBoundingClientRect()
							const { distance: distanceToCurrent } = distanceBetweenCircleAndRect(
								target.x,
								target.y,
								currentRect
							)

							// New element must be within threshold AND be significantly closer than current
							// Only consider if this element is much closer (by SNAP_DIFFERENCE_RATIO)
							if (
								distance <= threshold &&
								distance < distanceToCurrent * SNAP_DIFFERENCE_RATIO
							) {
								effectiveDistance = distance
							} else {
								// Skip this element - too far or not significantly closer
								continue
							}
						}
					}

					// If within threshold and effectively closer than previous closest
					if (distance <= threshold && effectiveDistance < closestDistance) {
						closestDistance = effectiveDistance
						closestCenter = { x: centerX, y: centerY } // Snap to center even though we calculated distance to bounding box
						closestElement = el
					}
				}

				// If we found a close element, snap to its center
				if (closestCenter && closestElement) {
					snappedTarget = closestCenter
					isSnapping = true
					currentlySnappedElementRef.current = closestElement
				} else {
					// No element within threshold, clear snapped reference
					currentlySnappedElementRef.current = null
				}
			} else {
				// No interactive elements, clear snapped reference
				currentlySnappedElementRef.current = null
			}

			// Smart lerping: faster when snapping, smoother for normal movement
			setPosition((prev) => {
				if (prev === null) {
					currentPositionRef.current = snappedTarget
					return snappedTarget
				}

				// Use faster lerp when snapping (0.95) for quick response to snap targets
				// Use slower lerp for normal movement (0.85) for smooth tracking
				const lerpFactor = isSnapping ? 0.5 : 0.25
				const newPos = {
					x: prev.x + (snappedTarget.x - prev.x) * lerpFactor,
					y: prev.y + (snappedTarget.y - prev.y) * lerpFactor,
				}
				currentPositionRef.current = newPos
				return newPos
			})

			// Hide cursor immediately when snapping is detected
			// Only unhide when snapping has completely stopped (no element within threshold)
			// Only do this if cursor should be visible (not hidden due to no hand/no pointing)
			if (isVisibleRef.current && cursorElement) {
				if (isSnapping) {
					// Cursor is snapping to an element, hide it immediately
					cursorElement.style.opacity = '0'
				} else {
					// Not snapping - check if we're definitely outside all interactive elements
					// Only show cursor if we're outside the snap threshold of all elements
					const currentPos = currentPositionRef.current
					if (currentPos) {
						let isNearAnyElement = false

						// Check if cursor is within snap threshold of any interactive element
						for (const el of interactiveElements) {
							const rect = el.getBoundingClientRect()
							if (rect.width === 0 || rect.height === 0) continue

							const { distance } = distanceBetweenCircleAndRect(
								currentPos.x,
								currentPos.y,
								rect
							)

							// If within threshold, we're still near an element
							if (distance <= SNAP_THRESHOLD) {
								isNearAnyElement = true
								break
							}
						}

						// Only show cursor if we're definitely outside all elements
						if (!isNearAnyElement) {
							cursorElement.style.opacity = '1'
						}
					} else {
						// No position, show cursor
						cursorElement.style.opacity = '1'
					}
				}
			}

			// Click detection: find element under cursor and handle clicks
			const currentPosForClick = currentPositionRef.current
			if (currentPosForClick) {
				const x = Math.round(currentPosForClick.x)
				const y = Math.round(currentPosForClick.y)

				// Temporarily hide cursor to find element underneath
				if (cursorElement) {
					cursorElement.style.display = 'none'
				}

				// Find element under cursor using elementFromPoint
				// Only support interactive elements (buttons, inputs, links, clickable elements)
				let element: Element | null = null

				// Helper function to check if element is interactive
				const isInteractiveElement = (el: Element): boolean => {
					// Explicitly exclude root div, body, and document elements
					if (
						el.tagName === 'BODY' ||
						el.tagName === 'HTML' ||
						el.id === 'root' ||
						el === document.body ||
						el === document.documentElement
					) {
						return false
					}

					const tagName = el.tagName.toLowerCase()
					const role = el.getAttribute('role')

					// Only check for actual interactive element types
					const isStandardInteractive =
						tagName === 'button' ||
						tagName === 'a' ||
						tagName === 'input' ||
						tagName === 'select' ||
						tagName === 'textarea' ||
						role === 'button' ||
						role === 'link' ||
						role === 'menuitem' ||
						role === 'tab' ||
						role === 'textbox'

					return isStandardInteractive
				}

				// Check if a dialog is open
				const openDialog = getOpenDialog()

				// Find element under cursor - prioritize elements with "interactive" class
				if (document.elementsFromPoint) {
					// Use elementsFromPoint to get all elements at point, then filter out cursor
					const elements = document.elementsFromPoint(x, y)
					let filteredElements = elements.filter((el) => el !== cursorElement)

					// If a dialog is open, only consider elements inside the dialog
					if (openDialog) {
						filteredElements = filteredElements.filter((el) =>
							isElementInDialog(el, openDialog)
						)
					}

					// First, try to find an element with "interactive" class
					const interactiveClassElements = filteredElements.filter((el) =>
						el.classList.contains('interactive')
					)

					if (interactiveClassElements.length > 0) {
						// Use the first (most specific) element with "interactive" class
						element = interactiveClassElements[0]
					} else {
						// Fallback to checking if it's an interactive element type
						const interactiveTypeElements = filteredElements.filter((el) =>
							isInteractiveElement(el)
						)
						element =
							interactiveTypeElements.length > 0 ? interactiveTypeElements[0] : null
					}
				} else {
					// Fallback to elementFromPoint
					const foundElement = document.elementFromPoint(x, y)
					if (foundElement === cursorElement) {
						element = null
					} else if (
						foundElement &&
						openDialog &&
						!isElementInDialog(foundElement, openDialog)
					) {
						// If dialog is open and element is not inside dialog, ignore it
						element = null
					} else if (foundElement?.classList.contains('interactive')) {
						element = foundElement
					} else if (foundElement && isInteractiveElement(foundElement)) {
						element = foundElement
					} else {
						element = null
					}
				}

				// Handle highlight state: add/remove "highlighted" class
				const prevHighlighted = highlightedElementRef.current

				// Remove highlight from previous element if different
				if (prevHighlighted && prevHighlighted !== element) {
					prevHighlighted.classList.remove('highlighted')
					highlightedElementRef.current = null
				}

				// Add highlight to current element if it has "interactive" class
				if (element && element.classList.contains('interactive')) {
					if (element !== prevHighlighted) {
						element.classList.add('highlighted')
						highlightedElementRef.current = element
					}
				} else {
					// Element doesn't have "interactive" class, so don't highlight
					highlightedElementRef.current = null
				}

				// Restore cursor visibility
				if (cursorElement) {
					cursorElement.style.display = 'block'
				}

				// Handle click detection: check if we have a pending click element from temporal gesture detection
				const pendingClickElement = pendingClickElementRef.current
				if (pendingClickElement) {
					// Only click if we're still over the same element that was under the cursor when click was detected
					if (element === pendingClickElement) {
						pendingClickElementRef.current = null // Reset
						const now = performance.now()
						// Throttle clicks to avoid spam (min 200ms between clicks)
						if (now - lastClickTimeRef.current > 200) {
							// Dispatch full click sequence with coordinates
							const clickX = Math.round(currentPosForClick.x)
							const clickY = Math.round(currentPosForClick.y)
							pendingClickElement.dispatchEvent(
								new MouseEvent('mousedown', {
									bubbles: true,
									cancelable: true,
									button: 0,
									clientX: clickX,
									clientY: clickY,
									screenX: clickX + window.screenX,
									screenY: clickY + window.screenY,
								})
							)
							pendingClickElement.dispatchEvent(
								new MouseEvent('mouseup', {
									bubbles: true,
									cancelable: true,
									button: 0,
									clientX: clickX,
									clientY: clickY,
									screenX: clickX + window.screenX,
									screenY: clickY + window.screenY,
								})
							)
							pendingClickElement.dispatchEvent(
								new MouseEvent('click', {
									bubbles: true,
									cancelable: true,
									button: 0,
									clientX: clickX,
									clientY: clickY,
									screenX: clickX + window.screenX,
									screenY: clickY + window.screenY,
								})
							)

							// Trigger click animation on the element
							if (pendingClickElement instanceof HTMLElement) {
								pendingClickElement.classList.add('gesture-clicked')
								// Remove animation class after animation completes
								setTimeout(() => {
									pendingClickElement.classList.remove('gesture-clicked')
								}, 400) // Match animation duration
							}

							lastClickTimeRef.current = now
						}
					} else {
						// Cursor moved away from the element before we could click - clear pending click
						pendingClickElementRef.current = null
					}
				}
			}

			animationFrameRef.current = requestAnimationFrame(animate)
		}

		// Start animation loop
		animationFrameRef.current = requestAnimationFrame(animate)

		return () => {
			isRunning = false
			if (animationFrameRef.current !== null) {
				cancelAnimationFrame(animationFrameRef.current)
				animationFrameRef.current = null
			}
			// Cleanup: remove highlight when component unmounts
			if (highlightedElementRef.current) {
				highlightedElementRef.current.classList.remove('highlighted')
				highlightedElementRef.current = null
			}
		}
	}, []) // Empty deps - animation loop runs independently, uses ref for latest gesture

	// Don't render if position is not set
	if (!position) {
		return null
	}

	return (
		<>
			<div
				ref={cursorElementRef}
				className="fixed pointer-events-none z-[110]"
				style={{
					left: `${position.x}px`,
					top: `${position.y}px`,
					transform: 'translate(-50%, -50%)',
					transition: 'opacity 0.2s ease-out', // Smooth opacity transition for hide/show
				}}
			>
				<div className="w-4 h-4 rounded-full bg-primary border-2 border-primary-foreground shadow-lg" />
			</div>
		</>
	)
}

export default Cursor
