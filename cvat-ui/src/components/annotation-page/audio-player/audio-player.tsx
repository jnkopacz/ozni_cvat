import React, { useEffect, useRef, useState } from 'react';
import { Slider, Button, Tooltip } from 'antd';
import {
    PlayCircleOutlined,
    PauseCircleOutlined,
    SoundOutlined,
    LoadingOutlined,
} from '@ant-design/icons';

import './styles.scss';

interface Props {
    jobInstance: any;
    frameFilename: string;
    frameNumber: number;
}

export default function AudioPlayer(props: Props): JSX.Element | null {
    const { jobInstance, frameFilename, frameNumber } = props;

    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [loading, setLoading] = useState(true);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [audioAvailable, setAudioAvailable] = useState(false);
    const [volume, setVolume] = useState(50);

    // Construct audio URL from frame filename
    const getAudioUrl = () => {
        if (!frameFilename) return null;
        return `http://192.168.2.88:5000/api/audio/${frameFilename}`;
    };

    const audioUrl = getAudioUrl();

    useEffect(() => {
        // Reset player state when frame changes
        if (audioRef.current) {
            audioRef.current.pause();
        }
        setPlaying(false);
        setCurrentTime(0);
        setAudioAvailable(false);
        setLoading(true);

        // Check if audio file exists for this frame
        if (audioUrl) {
            console.log('Checking audio availability:', audioUrl);
            fetch(`http://192.168.2.88:5000/api/audio_check/${frameFilename}`, {
                method: 'HEAD',
                mode: 'cors',
                credentials: 'include'
            })
                .then(response => {
                    console.log('Audio check response:', response.ok);
                    setAudioAvailable(response.ok);
                })
                .catch((error) => {
                    console.error('Audio check error:', error);
                    setAudioAvailable(false);
                })
                .finally(() => {
                    setLoading(false);
                });
        } else {
            setLoading(false);
        }
    }, [frameNumber, audioUrl, jobInstance.task_id, frameFilename]);

    // If loading or no audio available, return null (don't render anything)
    if (loading) {
        return null;
    }

    if (!audioAvailable) {
        return null;
    }

    const handlePlayPause = () => {
        if (audioRef.current) {
            if (playing) {
                audioRef.current.pause();
                setPlaying(false);
            } else {
                audioRef.current.play().catch(err => {
                    console.error('Error playing audio:', err);
                    setPlaying(false);
                });
                setPlaying(true);
            }
        }
    };

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const handleLoadedMetadata = () => {
        if (audioRef.current) {
            setDuration(audioRef.current.duration);
            setAudioAvailable(true);
            setLoading(false);
        }
    };

    const handleSliderChange = (value: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = value;
            setCurrentTime(value);
        }
    };

    const handleVolumeChange = (value: number) => {
        if (audioRef.current) {
            audioRef.current.volume = value / 100;
            setVolume(value);
        }
    };

    const handleEnded = () => {
        setPlaying(false);
        setCurrentTime(0);
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    return (
        <div className="cvat-audio-player">
            <audio
                ref={audioRef}
                src={audioUrl || ''}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={handleEnded}
                crossOrigin="use-credentials"
            />

            <div className="cvat-audio-player-controls">
                <Button
                    className="cvat-audio-player-button"
                    type="text"
                    onClick={handlePlayPause}
                    icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                />

                <div className="cvat-audio-player-timeline">
                    <span className="cvat-audio-player-time">{formatTime(currentTime)}</span>
                    <Slider
                        className="cvat-audio-player-slider"
                        value={currentTime}
                        min={0}
                        max={duration}
                        step={0.1}
                        onChange={handleSliderChange}
                    />
                    <span className="cvat-audio-player-time">{formatTime(duration)}</span>
                </div>

                <div className="cvat-audio-player-volume">
                    <SoundOutlined />
                    <Slider
                        className="cvat-audio-player-volume-slider"
                        value={volume}
                        min={0}
                        max={100}
                        onChange={handleVolumeChange}
                    />
                </div>
            </div>
        </div>
    );
}