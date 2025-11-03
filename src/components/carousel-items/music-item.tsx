import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Play, Pause, SkipForward } from 'lucide-react'

function MusicItem() {
	const [isPlaying, setIsPlaying] = useState(false)

	return (
		<div className="w-full h-full shrink-0 flex items-center justify-center p-8">
			<Card className="w-full max-w-2xl">
				<CardContent className="p-8">
					<div className="flex flex-col items-center gap-6">
						{/* Album Art */}
						<img
							src="https://upload.wikimedia.org/wikipedia/en/9/9b/Tame_Impala_-_Currents.png"
							alt="Currents album cover"
							className="w-64 h-64 rounded-xl shadow-lg object-cover"
						/>

						{/* Track Info */}
						<div className="text-center">
							<div className="text-2xl font-bold">The Less I Know The Better</div>
							<div className="text-muted-foreground mt-1">Tame Impala</div>
						</div>

						{/* Progress Bar */}
						<div className="w-full space-y-2">
							<div className="h-1 bg-muted rounded-full overflow-hidden">
								<div className="h-full bg-primary w-1/3"></div>
							</div>
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>2:01</span>
								<span>6:03</span>
							</div>
						</div>

						{/* Controls */}
						<div className="flex items-center gap-8">
							<Button
								variant="ghost"
								size="icon"
								className="interactive h-12 w-12"
								aria-label="Previous track"
							>
								<SkipForward className="h-5 w-5 rotate-180" />
							</Button>
							<Button
								variant="default"
								size="icon"
								className="interactive h-16 w-16 rounded-full"
								onClick={() => setIsPlaying(!isPlaying)}
								aria-label={isPlaying ? 'Pause' : 'Play'}
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
								className="interactive h-12 w-12"
								aria-label="Next track"
							>
								<SkipForward className="h-5 w-5" />
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

export default MusicItem
