import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Play, Pause, SkipForward, Loader2, Music } from 'lucide-react'
import { spotifyService } from '@/lib/spotify-service'
import type { TrackInfo, PlaybackStateInfo, ContextInfo } from '@/lib/spotify-service'

// Scrolling text component - defined outside to prevent recreation on re-renders
const ScrollingText = React.memo(
	({
		text,
		className = '',
		maxWidth = 'w-full',
	}: {
		text: string
		className?: string
		maxWidth?: string
	}) => {
		const textRef = useRef<HTMLSpanElement>(null)
		const containerRef = useRef<HTMLDivElement>(null)
		const measureRef = useRef<HTMLSpanElement>(null)
		const [shouldScroll, setShouldScroll] = useState(false)
		const [scrollDistance, setScrollDistance] = useState(0)
		const lastTextRef = useRef<string>('')
		const initializedRef = useRef(false)
		const animationAppliedRef = useRef(false)

		useEffect(() => {
			// Only recalculate if text actually changed
			if (lastTextRef.current === text && initializedRef.current) {
				return
			}
			lastTextRef.current = text
			initializedRef.current = false
			animationAppliedRef.current = false

			// Use requestAnimationFrame to ensure DOM is ready
			const checkWidth = () => {
				if (measureRef.current && containerRef.current) {
					// Measure text width using a hidden element with no wrapping
					const textWidth = measureRef.current.offsetWidth
					const containerWidth = containerRef.current.offsetWidth
					const needsScroll = textWidth > containerWidth

					if (needsScroll) {
						// Calculate how far to scroll (text width - container width)
						const newDistance = textWidth - containerWidth
						setShouldScroll(true)
						setScrollDistance(newDistance)

						// Apply animation directly to DOM element to avoid React reconciliation
						if (textRef.current && !animationAppliedRef.current) {
							textRef.current.style.setProperty(
								'animation',
								'scroll-text-default 8s ease-in-out infinite'
							)
							textRef.current.style.setProperty(
								'--scroll-distance',
								`${newDistance}px`
							)
							animationAppliedRef.current = true
						}
					} else {
						setShouldScroll(false)
						setScrollDistance(0)
						if (textRef.current) {
							textRef.current.style.removeProperty('animation')
							textRef.current.style.removeProperty('--scroll-distance')
							animationAppliedRef.current = false
						}
					}
					initializedRef.current = true
				}
			}

			// Check immediately and after a short delay
			checkWidth()
			const timeoutId = setTimeout(checkWidth, 100)
			const rafId = requestAnimationFrame(checkWidth)
			return () => {
				clearTimeout(timeoutId)
				cancelAnimationFrame(rafId)
			}
		}, [text])

		// Update CSS variable when scrollDistance changes, but don't touch animation property
		useEffect(() => {
			if (
				textRef.current &&
				shouldScroll &&
				scrollDistance > 0 &&
				animationAppliedRef.current
			) {
				// Only update the CSS variable, don't touch the animation property
				textRef.current.style.setProperty('--scroll-distance', `${scrollDistance}px`)
			}
		}, [scrollDistance, shouldScroll])

		return (
			<>
				{/* Hidden element to measure text width - positioned off-screen */}
				<span
					ref={measureRef}
					className={`${className} whitespace-nowrap pointer-events-none`}
					style={{
						position: 'absolute',
						visibility: 'hidden',
						left: '-9999px',
						top: '-9999px',
					}}
				>
					{text}
				</span>
				{shouldScroll && scrollDistance > 0 ? (
					<div
						className={`${maxWidth} overflow-hidden relative whitespace-nowrap`}
						ref={containerRef}
					>
						<div className="scrolling-text-wrapper">
							<span
								className={`scrolling-text ${className}`}
								ref={textRef}
								// Don't use inline styles - we set them directly via ref
							>
								{text}
							</span>
						</div>
					</div>
				) : (
					<div
						className={`${maxWidth} overflow-hidden whitespace-nowrap`}
						ref={containerRef}
					>
						<span className={className}>{text}</span>
					</div>
				)}
			</>
		)
	},
	(prevProps, nextProps) => {
		// Only re-render if text actually changed
		return prevProps.text === nextProps.text
	}
)

function MusicItem() {
	const [isAuthenticated, setIsAuthenticated] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Playback state
	const [isPlaying, setIsPlaying] = useState(false)
	const [trackInfo, setTrackInfo] = useState<TrackInfo | null>(null)
	const [progress, setProgress] = useState(0)
	const [contextUri, setContextUri] = useState<string | null>(null)
	const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null)
	const [hasActivePlayback, setHasActivePlayback] = useState(false)
	const [activeDeviceName, setActiveDeviceName] = useState<string | null>(null)

	// User profile
	const [userProfile, setUserProfile] = useState<{
		display_name: string
		images: Array<{ url: string }>
	} | null>(null)

	// Refs for polling
	const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const localProgressRef = useRef(0)
	const lastUpdateTimeRef = useRef(Date.now())
	const isInitializedRef = useRef(false)

	// Format time in MM:SS format
	const formatTime = (ms: number): string => {
		const totalSeconds = Math.floor(ms / 1000)
		const minutes = Math.floor(totalSeconds / 60)
		const seconds = totalSeconds % 60
		return `${minutes}:${seconds.toString().padStart(2, '0')}`
	}

	// Update UI from playback state info
	const updatePlaybackState = useCallback((stateInfo: PlaybackStateInfo) => {
		setIsPlaying(stateInfo.isPlaying)
		setHasActivePlayback(stateInfo.hasActivePlayback)
		setActiveDeviceName(stateInfo.activeDeviceName)
		setTrackInfo(stateInfo.trackInfo)
		setContextUri(stateInfo.contextUri)
		setContextInfo(stateInfo.contextInfo)

		if (stateInfo.hasActivePlayback && stateInfo.trackInfo) {
			setProgress(stateInfo.progress)
			localProgressRef.current = stateInfo.progress
			lastUpdateTimeRef.current = Date.now()
		} else {
			setProgress(0)
			localProgressRef.current = 0
		}
	}, [])

	// Poll playback state and device status
	const pollPlaybackState = useCallback(async () => {
		if (!isAuthenticated) return

		const stateInfo = await spotifyService.pollAndUpdatePlaybackState()
		updatePlaybackState(stateInfo)
	}, [isAuthenticated, updatePlaybackState])

	// Start polling
	const startPolling = useCallback(() => {
		if (pollingIntervalRef.current) {
			clearInterval(pollingIntervalRef.current)
		}

		pollingIntervalRef.current = setInterval(() => {
			pollPlaybackState()
		}, 2000) // Poll every 2 seconds
	}, [pollPlaybackState])

	// Stop polling
	const stopPolling = useCallback(() => {
		if (pollingIntervalRef.current) {
			clearInterval(pollingIntervalRef.current)
			pollingIntervalRef.current = null
		}
	}, [])

	// Update progress locally between polls
	useEffect(() => {
		if (!isPlaying || !trackInfo) return

		const interval = setInterval(() => {
			const now = Date.now()
			const elapsed = now - lastUpdateTimeRef.current
			const newProgress = Math.min(localProgressRef.current + elapsed, trackInfo.duration)
			localProgressRef.current = newProgress
			setProgress(newProgress)
			lastUpdateTimeRef.current = now

			// If we're close to the end (within 3 seconds), poll again
			if (newProgress >= trackInfo.duration - 3000) {
				pollPlaybackState()
			}
		}, 100) // Update every 100ms for smooth progress bar

		return () => clearInterval(interval)
	}, [isPlaying, trackInfo, pollPlaybackState])

	// Initialize playback on authentication and start continuous polling
	useEffect(() => {
		if (!isAuthenticated) {
			stopPolling()
			return
		}

		// Start continuous polling when authenticated (every 5 seconds)
		startPolling()

		if (!isInitializedRef.current) {
			isInitializedRef.current = true
			setIsLoading(true)

			const initializePlayback = async () => {
				try {
					const { playbackState, userProfile: profile } =
						await spotifyService.initializePlaybackState()

					if (profile) {
						setUserProfile(profile)
					}

					updatePlaybackState(playbackState)
				} catch (err) {
					setError(err instanceof Error ? err.message : 'Failed to initialize playback')
				} finally {
					setIsLoading(false)
				}
			}

			initializePlayback()
		}

		return () => {
			stopPolling()
		}
	}, [isAuthenticated, updatePlaybackState, startPolling, stopPolling])

	// Check authentication status on mount
	useEffect(() => {
		setIsAuthenticated(spotifyService.isAuthenticated())
	}, [])

	// Handle callback from Spotify redirect
	useEffect(() => {
		const handleCallback = async () => {
			const urlParams = new URLSearchParams(window.location.search)
			const code = urlParams.get('code')
			const state = urlParams.get('state')
			const error = urlParams.get('error')

			if (error) {
				setError(`Authentication failed: ${error}`)
				window.history.replaceState({}, document.title, window.location.pathname)
				return
			}

			if (code && state) {
				setIsLoading(true)
				setError(null)

				try {
					await spotifyService.exchangeCodeForToken(code, state)
					setIsAuthenticated(true)
					window.history.replaceState({}, document.title, window.location.pathname)
				} catch (err) {
					setError(
						err instanceof Error ? err.message : 'Failed to authenticate with Spotify'
					)
					setIsAuthenticated(false)
				} finally {
					setIsLoading(false)
				}
			}
		}

		handleCallback()
	}, [])

	const handleLogin = async () => {
		setIsLoading(true)
		setError(null)

		try {
			const authUrl = await spotifyService.initiateLogin()
			window.location.href = authUrl
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to initiate login')
			setIsLoading(false)
		}
	}

	const handlePlayPause = async () => {
		if (isPlaying) {
			await spotifyService.pausePlayback()
			setIsPlaying(false)
			stopPolling()
		} else {
			// If there's active playback (just paused), resume without contextUri
			// Only pass contextUri if there's no active playback (new session)
			if (hasActivePlayback) {
				await spotifyService.startPlayback()
			} else {
				await spotifyService.startPlayback(contextUri || undefined)
			}
			setIsPlaying(true)
			lastUpdateTimeRef.current = Date.now()
			// Poll immediately to get updated state
			setTimeout(() => {
				pollPlaybackState()
				startPolling()
			}, 500)
		}
	}

	const handleSkipNext = async () => {
		await spotifyService.skipToNext()
		// Poll immediately to get new track
		setTimeout(() => {
			pollPlaybackState()
		}, 500)
	}

	const handleSkipPrevious = async () => {
		await spotifyService.skipToPrevious()
		// Poll immediately to get new track
		setTimeout(() => {
			pollPlaybackState()
		}, 500)
	}

	// Calculate progress percentage
	const progressPercentage =
		trackInfo && trackInfo.duration > 0 ? (progress / trackInfo.duration) * 100 : 0

	return (
		<div className="w-full h-full shrink-0 flex items-center justify-center p-8">
			<Card className="w-full max-w-2xl">
				<CardHeader>
					<div className="flex items-center justify-between gap-4">
						<CardTitle className="flex items-center gap-2">
							<img
								src="https://storage.googleapis.com/pr-newsroom-wp/1/2018/11/Spotify_Logo_RGB_Green.png"
								alt="Spotify"
								className="h-7 w-auto"
								onError={(e) => {
									e.currentTarget.style.display = 'none'
								}}
							/>
						</CardTitle>
						{/* Context Info - only show during active playback */}
						{hasActivePlayback && contextInfo && (
							<div className="flex items-center flex-1 justify-center min-w-0">
								<div className="max-w-[200px] min-w-0">
									<ScrollingText
										text={contextInfo.name}
										className="text-sm font-medium text-muted-foreground block"
										maxWidth="w-full"
									/>
								</div>
							</div>
						)}
						{isAuthenticated && userProfile && (
							<div className="flex items-center gap-2">
								{userProfile.images?.[0]?.url ? (
									<img
										src={userProfile.images[0].url}
										alt={userProfile.display_name}
										className="h-8 w-8 rounded-full object-cover"
									/>
								) : (
									<div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
										<Music className="h-4 w-4 text-muted-foreground" />
									</div>
								)}
								<span className="text-sm font-medium">
									{userProfile.display_name}
								</span>
							</div>
						)}
					</div>
				</CardHeader>
				<CardContent className="p-8 pb-0">
					{!isAuthenticated ? (
						<div className="flex flex-col items-center gap-4">
							{error && (
								<div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md w-full">
									{error}
								</div>
							)}
							<div className="text-center">
								<div className="text-lg font-medium mb-2">Connect to Spotify</div>
								<div className="text-sm text-muted-foreground mb-4">
									Login to Spotify to control playback
								</div>
							</div>
							<Button
								onClick={handleLogin}
								disabled={isLoading}
								className="interactive"
							>
								{isLoading ? (
									<>
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
										Connecting...
									</>
								) : (
									'Login with Spotify'
								)}
							</Button>
						</div>
					) : isLoading && !trackInfo ? (
						<div className="flex flex-col items-center gap-4">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
							<div className="text-sm text-muted-foreground">Loading playback...</div>
						</div>
					) : (
						<div className="flex flex-col items-center gap-6">
							{/* Album Art */}
							{hasActivePlayback && trackInfo?.albumCover ? (
								<img
									src={trackInfo.albumCover}
									alt={trackInfo.album || 'Album cover'}
									className="w-64 h-64 rounded-xl shadow-lg object-cover"
								/>
							) : (
								<div className="w-64 h-64 rounded-xl shadow-lg bg-muted flex items-center justify-center">
									<Music className="h-24 w-24 text-muted-foreground" />
								</div>
							)}

							{/* Track Info - always show to maintain static layout */}
							<div className="text-center min-h-16 w-full max-w-md">
								{trackInfo ? (
									<>
										<ScrollingText
											text={trackInfo.name}
											className="text-2xl font-bold block"
											maxWidth="w-full"
										/>
										<div className="text-muted-foreground mt-1">
											<ScrollingText
												text={trackInfo.artists.join(', ')}
												className="block"
												maxWidth="w-full"
											/>
										</div>
									</>
								) : (
									<div className="text-2xl font-bold text-transparent">
										No track loaded
									</div>
								)}
							</div>

							{/* Progress Bar - always show to maintain static layout */}
							<div className="w-full space-y-2">
								<div className="h-1 bg-muted rounded-full overflow-hidden">
									{hasActivePlayback && trackInfo && (
										<div
											className="h-full bg-primary transition-all duration-100"
											style={{ width: `${progressPercentage}%` }}
										/>
									)}
								</div>
								{hasActivePlayback && trackInfo && (
									<div className="flex justify-between text-xs text-muted-foreground h-4">
										<span>{formatTime(progress)}</span>
										<span>{formatTime(trackInfo.duration)}</span>
									</div>
								)}
								{!hasActivePlayback && <div className="h-4"></div>}
							</div>

							{/* Controls */}
							<div className="flex flex-col items-center gap-8">
								<div className="flex items-center gap-8">
									<Button
										variant="ghost"
										size="icon"
										className={`h-12 w-12 ${
											hasActivePlayback
												? 'interactive'
												: 'opacity-50 cursor-not-allowed'
										}`}
										aria-label="Previous track"
										onClick={handleSkipPrevious}
										disabled={isLoading || !hasActivePlayback}
									>
										<SkipForward className="h-5 w-5 rotate-180" />
									</Button>
									<Button
										variant="default"
										size="icon"
										className={`h-16 w-16 rounded-full ${
											hasActivePlayback
												? 'interactive'
												: 'opacity-50 cursor-not-allowed'
										}`}
										onClick={handlePlayPause}
										aria-label={isPlaying ? 'Pause' : 'Play'}
										disabled={isLoading || !hasActivePlayback}
									>
										{isPlaying ? (
											<Pause className="h-6 w-6" />
										) : (
											<Play className="h-6 w-6" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className={`h-12 w-12 ${
											hasActivePlayback
												? 'interactive'
												: 'opacity-50 cursor-not-allowed'
										}`}
										aria-label="Next track"
										onClick={handleSkipNext}
										disabled={isLoading || !hasActivePlayback}
									>
										<SkipForward className="h-5 w-5" />
									</Button>
								</div>
								{/* Device name - always render to maintain static layout */}
								<div className="text-xs text-muted-foreground h-4">
									{activeDeviceName || '\u00A0'}
								</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

export default MusicItem
