import React, { useState, useRef, useEffect } from 'react';
import { IconButton, Typography, Paper, Button } from '@material-ui/core';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import PauseIcon from '@material-ui/icons/Pause';
import FullscreenIcon from '@material-ui/icons/Fullscreen';
import FullscreenExitIcon from '@material-ui/icons/FullscreenExit';
import CloseIcon from '@material-ui/icons/Close';
import Colors from '../../colors';

const VideoPlayer = ({ stream, paused, togglePlayPause, trackType, controllerState, virtualControlsEnabled, handleJoystickTouch, setVideoFullscreen }) => {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(!paused);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showControllerOverlay, setShowControllerOverlay] = useState(true);
  const [localSteering, setLocalSteering] = useState(0);
  const [localThrottle, setLocalThrottle] = useState(0);
  const [joystickCenter, setJoystickCenter] = useState({ x: 0, y: 0 });
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickTouch, setJoystickTouch] = useState(null);
  const [useInvertSteering, setUseInvertSteering] = useState(false);
  const joystickRef = useRef(null);
  
  // Add refs to track the previous values for smoother transitions
  const prevSteeringRef = useRef(0);
  const prevThrottleRef = useRef(0);
  const animationFrameRef = useRef(null);
  
  // Add a timestamp for update throttling to prevent flickering
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    setIsPlaying(!paused);
  }, [paused]);

  // Update local steering and throttle values when controllerState changes
  useEffect(() => {
    if (controllerState) {
      // Don't update local values if the joystick is active (being manipulated)
      // This prevents conflicts between the physical controller and virtual joystick
      if (!joystickActive) {
        // Set the local values immediately without any throttling or animation
        setLocalSteering(controllerState.steering);
        setLocalThrottle(controllerState.throttle);
        
        // Update invert setting
        setUseInvertSteering(controllerState.invertSteering || false);
      }
    }
  }, [controllerState, joystickActive]);

  // Add document-level mouse move and up handlers for PC
  useEffect(() => {
    // Only add these handlers when the joystick is active in fullscreen mode
    if (isFullscreen && virtualControlsEnabled && joystickActive) {
      const handleMouseMove = (e) => {
        if (joystickActive) {
          handleJoystickMouseMove(e);
        }
      };
      
      const handleMouseUp = (e) => {
        if (joystickActive) {
          handleJoystickMouseUp(e);
        }
      };
      
      // Handle cases where mouse is released outside the window
      const handleBlur = () => {
        if (joystickActive) {
          // Reset joystick when focus is lost
          setJoystickActive(false);
          setLocalSteering(0);
          setLocalThrottle(0);
          if (handleJoystickTouch) {
            handleJoystickTouch(0, 0);
          }
        }
      };
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleBlur);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('blur', handleBlur);
      };
    }
  }, [isFullscreen, virtualControlsEnabled, joystickActive]);

  // Prevent default behavior for gamepad or controller inputs to avoid browser navigation
  useEffect(() => {
    const preventDefaultForGamepad = (e) => {
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents === false) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Block navigation keys and gamepad events when in fullscreen
    const preventNavigationKeys = (e) => {
      if (isFullscreen && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace', 'Escape'].includes(e.key)) {
        e.preventDefault();
      }
    };

    window.addEventListener('gamepadconnected', preventDefaultForGamepad);
    window.addEventListener('gamepaddisconnected', preventDefaultForGamepad);
    document.addEventListener('keydown', preventNavigationKeys, { passive: false });

    return () => {
      window.removeEventListener('gamepadconnected', preventDefaultForGamepad);
      window.removeEventListener('gamepaddisconnected', preventDefaultForGamepad);
      document.removeEventListener('keydown', preventNavigationKeys);
    };
  }, [isFullscreen]);
  
  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Add a dedicated updateInterval to ensure controller values are displayed
  // even when no new events are coming in
  useEffect(() => {
    // Only needed for fullscreen mode with physical controller
    if (isFullscreen && !virtualControlsEnabled && controllerState) {
      const timer = setInterval(() => {
        // This ensures the display stays updated even if values haven't changed
        // Acts as a heartbeat to keep the UI in sync
        setLocalSteering(prevSteering => {
          // Only update if value is different to avoid unnecessary re-renders
          return controllerState.steering !== prevSteering 
            ? controllerState.steering 
            : prevSteering;
        });
        
        setLocalThrottle(prevThrottle => {
          return controllerState.throttle !== prevThrottle 
            ? controllerState.throttle 
            : prevThrottle;
        });
      }, 33); // ~30fps update rate for the UI, not too fast to cause flicker
      
      return () => clearInterval(timer);
    }
  }, [isFullscreen, virtualControlsEnabled, controllerState]);

  // Toggle fullscreen mode
  const toggleFullscreen = () => {
    if (!isFullscreen) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  };

  // Enter fullscreen mode
  const enterFullscreen = () => {
    if (containerRef.current) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
      } else if (containerRef.current.webkitRequestFullscreen) {
        containerRef.current.webkitRequestFullscreen();
      } else if (containerRef.current.msRequestFullscreen) {
        containerRef.current.msRequestFullscreen();
      }
      setIsFullscreen(true);
      setShowControls(true);
      
      // Notify parent component about fullscreen state
      if (setVideoFullscreen) {
        setVideoFullscreen(true);
      }
    }
  };

  // Exit fullscreen mode
  const exitFullscreen = () => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
    setIsFullscreen(false);
    
    // Notify parent component about fullscreen state
    if (setVideoFullscreen) {
      setVideoFullscreen(false);
    }
  };

  // Toggle mouse controls visibility
  const toggleControls = () => {
    setShowControls(prev => !prev);
  };

  // Toggle controller overlay visibility
  const toggleControllerOverlay = (e) => {
    e.stopPropagation(); // Prevent video click event
    setShowControllerOverlay(prev => !prev);
  };

  // Handle play/pause click
  const handlePlayPauseClick = () => {
    if (togglePlayPause) {
      togglePlayPause();
    }

    // Also update local state
    setIsPlaying(!isPlaying);
  };

  // Virtual joystick handlers
  const handleJoystickTouchStart = (e) => {
    e.preventDefault();
    if (!joystickRef.current) return;
    
    // Get the first touch
    const touch = e.touches[0];
    
    // Get joystick element's position
    const rect = joystickRef.current.getBoundingClientRect();
    
    // Calculate the center of the joystick
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // Store the joystick center and touch info
    setJoystickCenter({ x: centerX, y: centerY });
    setJoystickTouch({ id: touch.identifier });
    
    // Calculate initial position
    const maxHorizontalOffset = rect.width / 2;
    const horizontalOffset = touch.clientX - centerX;
    let newSteering = horizontalOffset / maxHorizontalOffset;
    newSteering = Math.max(-1, Math.min(1, newSteering)); // Clamp between -1 and 1
    
    const maxVerticalOffset = rect.height / 2;
    const verticalOffset = centerY - touch.clientY; // Reversed because Y increases downward
    let newThrottle = verticalOffset / maxVerticalOffset;
    newThrottle = Math.max(-1, Math.min(1, newThrottle)); // Clamp between -1 and 1
    
    // Update local state
    setLocalSteering(newSteering);
    setLocalThrottle(newThrottle);
    setJoystickActive(true);
    
    // Send to parent if needed
    if (handleJoystickTouch) {
      // Apply steering inversion if enabled
      const finalSteering = useInvertSteering ? -newSteering : newSteering;
      handleJoystickTouch(finalSteering, newThrottle);
    }
  };
  
  const handleJoystickTouchMove = (e) => {
    e.preventDefault();
    if (!joystickTouch || !joystickRef.current) return;
    
    // Find the touch that matches our stored ID
    let activeTouch = null;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === joystickTouch.id) {
        activeTouch = e.touches[i];
        break;
      }
    }
    
    // If we can't find the touch, exit
    if (!activeTouch) return;
    
    const rect = joystickRef.current.getBoundingClientRect();
    const maxHorizontalOffset = rect.width / 2;
    const maxVerticalOffset = rect.height / 2;
    
    // Calculate horizontal movement for steering
    const horizontalOffset = activeTouch.clientX - joystickCenter.x;
    let newSteering = horizontalOffset / maxHorizontalOffset;
    newSteering = Math.max(-1, Math.min(1, newSteering)); // Clamp between -1 and 1
    
    // Calculate vertical movement for throttle
    const verticalOffset = joystickCenter.y - activeTouch.clientY;
    let newThrottle = verticalOffset / maxVerticalOffset;
    newThrottle = Math.max(-1, Math.min(1, newThrottle)); // Clamp between -1 and 1
    
    // Update local state
    setLocalSteering(newSteering);
    setLocalThrottle(newThrottle);
    
    // Send to parent if needed
    if (handleJoystickTouch) {
      // Apply steering inversion if enabled
      const finalSteering = useInvertSteering ? -newSteering : newSteering;
      handleJoystickTouch(finalSteering, newThrottle);
    }
  };
  
  const handleJoystickTouchEnd = (e) => {
    e.preventDefault();
    
    // Check if our tracked touch has ended
    // by looking through remaining touches
    let touchFound = false;
    for (let i = 0; i < e.touches.length; i++) {
      if (joystickTouch && e.touches[i].identifier === joystickTouch.id) {
        touchFound = true;
        break;
      }
    }
    
    // If our touch is no longer in the list, reset
    if (!touchFound) {
      setJoystickTouch(null);
      setLocalSteering(0);
      setLocalThrottle(0);
      setJoystickActive(false);
      
      // Send to parent if needed
      if (handleJoystickTouch) {
        handleJoystickTouch(0, 0);
      }
    }
  };

  // Handle mouse events for desktop
  const handleJoystickMouseDown = (e) => {
    e.preventDefault();
    if (!joystickRef.current) return;
    
    // Get the joystick element's position
    const rect = joystickRef.current.getBoundingClientRect();
    
    // Calculate the center of the joystick
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // Store joystick center for future calculations
    setJoystickCenter({ x: centerX, y: centerY });
    
    // Calculate initial position
    const maxHorizontalOffset = rect.width / 2;
    const horizontalOffset = e.clientX - centerX;
    let newSteering = horizontalOffset / maxHorizontalOffset;
    newSteering = Math.max(-1, Math.min(1, newSteering)); // Clamp between -1 and 1
    
    const maxVerticalOffset = rect.height / 2;
    const verticalOffset = centerY - e.clientY; // Reversed because Y increases downward
    let newThrottle = verticalOffset / maxVerticalOffset;
    newThrottle = Math.max(-1, Math.min(1, newThrottle)); // Clamp between -1 and 1
    
    // Update local state
    setLocalSteering(newSteering);
    setLocalThrottle(newThrottle);
    setJoystickActive(true);
    
    // Send to parent if needed
    if (handleJoystickTouch) {
      // Apply steering inversion if enabled
      const finalSteering = useInvertSteering ? -newSteering : newSteering;
      handleJoystickTouch(finalSteering, newThrottle);
    }
  };
  
  const handleJoystickMouseMove = (e) => {
    e.preventDefault();
    if (!joystickActive || !joystickRef.current) return;
    
    const rect = joystickRef.current.getBoundingClientRect();
    const maxHorizontalOffset = rect.width / 2;
    const maxVerticalOffset = rect.height / 2;
    
    // Calculate horizontal movement for steering (left to right: -1 to 1)
    const horizontalOffset = e.clientX - joystickCenter.x;
    let newSteering = horizontalOffset / maxHorizontalOffset;
    newSteering = Math.max(-1, Math.min(1, newSteering)); // Clamp between -1 and 1
    
    // Calculate vertical movement for throttle (down to up: -1 to 1)
    const verticalOffset = joystickCenter.y - e.clientY;
    let newThrottle = verticalOffset / maxVerticalOffset;
    newThrottle = Math.max(-1, Math.min(1, newThrottle)); // Clamp between -1 and 1
    
    // Update local state
    setLocalSteering(newSteering);
    setLocalThrottle(newThrottle);
    
    // Send to parent if needed
    if (handleJoystickTouch) {
      // Apply steering inversion if enabled
      const finalSteering = useInvertSteering ? -newSteering : newSteering;
      handleJoystickTouch(finalSteering, newThrottle);
    }
  };
  
  const handleJoystickMouseUp = (e) => {
    e.preventDefault();
    if (!joystickActive) return;
    
    // Reset joystick to center position
    setLocalSteering(0);
    setLocalThrottle(0);
    setJoystickActive(false);
    
    // Send to parent if needed
    if (handleJoystickTouch) {
      handleJoystickTouch(0, 0);
    }
  };

  // Get controller values from props or use defaults
  const steering = controllerState?.steering ?? 0;
  const throttle = controllerState?.throttle ?? 0;
  const invertSteering = controllerState?.invertSteering ?? false;

  // Joystick thumb style - remove all transitions for immediate response
  const joystickThumbStyle = {
    position: "absolute",
    left: `${50 + localSteering * 50}%`,
    top: `${50 - localThrottle * 50}%`,
    transform: "translate(-50%, -50%)",
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    backgroundColor: Colors.blue500,
    border: "3px solid white",
    zIndex: 2
  };

  // Add listener for fullscreen change events from browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreenNow = Boolean(
        document.fullscreenElement || 
        document.webkitFullscreenElement || 
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      
      setIsFullscreen(isFullscreenNow);
      
      // Notify parent component about fullscreen state
      if (setVideoFullscreen) {
        setVideoFullscreen(isFullscreenNow);
      }
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [setVideoFullscreen]);

  return (
    <div 
      ref={containerRef}
      style={{
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? 0 : 'auto',
        left: isFullscreen ? 0 : 'auto',
        width: isFullscreen ? '100vw' : '100%',
        height: isFullscreen ? '100vh' : 'auto',
        zIndex: isFullscreen ? 9999 : 'auto',
        backgroundColor: isFullscreen ? '#000' : 'transparent',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      {isFullscreen && (
        <div style={{ 
          position: 'absolute', 
          top: 10, 
          left: 0, 
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0 20px',
          zIndex: 10000,
          backgroundColor: 'rgba(0,0,0,0.5)',
        }}>
          <Typography variant="h6" style={{ color: Colors.white }}>
            {trackType}
          </Typography>
          <IconButton 
            onClick={exitFullscreen}
            style={{ color: Colors.white }}
          >
            <CloseIcon />
          </IconButton>
        </div>
      )}

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: isFullscreen ? '100%' : 'auto',
          maxHeight: isFullscreen ? '100vh' : '500px',
          backgroundColor: '#000',
          objectFit: isFullscreen ? 'contain' : 'cover',
        }}
        onClick={toggleControls}
      />

      {/* Virtual Joystick Overlay - ONLY show in fullscreen mode when enabled */}
      {isFullscreen && virtualControlsEnabled && (
        <div style={{
          position: 'absolute',
          left: '20px',
          bottom: '100px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 10000,
        }}>
          <div style={{
            backgroundColor: 'rgba(0,0,0,0.6)',
            padding: '4px 10px',
            borderRadius: '4px',
            marginBottom: '5px'
          }}>
            <Typography variant="caption" style={{ color: Colors.white }}>
              Virtual Controls {useInvertSteering ? "(Inverted)" : ""}
            </Typography>
          </div>
          
          <div 
            ref={joystickRef}
            style={{
              width: '200px',
              height: '200px',
              backgroundColor: 'rgba(0,0,0,0.5)',
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.3)',
              touchAction: 'none',
              cursor: 'grab',
              position: 'relative',
              boxShadow: '0 4px 8px rgba(0,0,0,0.5)'
            }}
            onTouchStart={handleJoystickTouchStart}
            onTouchMove={handleJoystickTouchMove}
            onTouchEnd={handleJoystickTouchEnd}
            onTouchCancel={handleJoystickTouchEnd}
            onMouseDown={handleJoystickMouseDown}
          >
            {/* Joystick background lines */}
            <div style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: '2px',
              backgroundColor: 'rgba(255,255,255,0.4)',
              zIndex: 1
            }} />
            <div style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: '2px',
              backgroundColor: 'rgba(255,255,255,0.4)',
              zIndex: 1
            }} />
            
            {/* Joystick thumb */}
            <div style={joystickThumbStyle} />
            
            {/* Labels */}
            <div style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: '12px',
              zIndex: 1
            }}>
              {useInvertSteering ? "RIGHT" : "LEFT"}
            </div>
            <div style={{
              position: 'absolute',
              right: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: '12px',
              zIndex: 1
            }}>
              {useInvertSteering ? "LEFT" : "RIGHT"}
            </div>
            <div style={{
              position: 'absolute',
              top: '10px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: Colors.green500,
              fontSize: '12px',
              zIndex: 1
            }}>
              THROTTLE
            </div>
            <div style={{
              position: 'absolute',
              bottom: '10px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: Colors.orange500,
              fontSize: '12px',
              zIndex: 1
            }}>
              BRAKE
            </div>
          </div>
          
          {/* Control values and options */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            marginTop: '5px',
            backgroundColor: 'rgba(0,0,0,0.6)',
            padding: '4px 10px',
            borderRadius: '4px',
            flexDirection: 'column'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" style={{ color: Colors.white }}>
                Steer: {localSteering.toFixed(2)}
              </Typography>
              <Typography variant="caption" style={{ color: Colors.white }}>
                Throttle: {localThrottle.toFixed(2)}
              </Typography>
            </div>
            
            {/* Invert steering option */}
            <div 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                marginTop: '4px', 
                cursor: 'pointer' 
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setUseInvertSteering(!useInvertSteering);
              }}
            >
              <div style={{ 
                width: '16px', 
                height: '16px', 
                border: '1px solid white', 
                marginRight: '6px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: useInvertSteering ? 'rgba(255,255,255,0.8)' : 'transparent'
              }}>
                {useInvertSteering && <span style={{ color: 'black', fontSize: '12px' }}>✓</span>}
              </div>
              <Typography variant="caption" style={{ color: Colors.white }}>
                Invert Steering
              </Typography>
            </div>
          </div>
        </div>
      )}

      {/* Controller Status Overlay in Fullscreen Mode */}
      {isFullscreen && showControllerOverlay && !virtualControlsEnabled && (
        <div style={{
          position: 'absolute',
          top: '50%',
          right: 20,
          transform: 'translateY(-50%)',
          backgroundColor: 'rgba(0,0,0,0.6)',
          padding: '10px',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
          zIndex: 10000,
        }}>
          <Typography variant="body2" style={{ color: Colors.white, fontWeight: 'bold' }}>
            Controller Status
          </Typography>
          
          {/* Steering Indicator */}
          <div style={{ width: '100%' }}>
            <Typography variant="caption" style={{ color: Colors.white }}>
              Steering: {localSteering.toFixed(2)} {useInvertSteering ? "(Inverted)" : ""}
            </Typography>
            <div style={{
              width: '120px',
              height: '20px',
              backgroundColor: Colors.grey900,
              position: 'relative',
              borderRadius: '4px',
              overflow: 'hidden',
              marginTop: '2px'
            }}>
              <div style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                bottom: 0,
                width: '2px',
                backgroundColor: Colors.white30
              }} />
              <div style={{
                position: 'absolute',
                left: `${50 + localSteering * 50}%`,
                top: 0,
                bottom: 0,
                width: '10px',
                backgroundColor: Math.abs(localSteering) > 0.7 ? Colors.red500 : Colors.blue500,
                transform: 'translateX(-50%)',
                transition: 'left 0.015s linear' // Minimal transition
              }} />
            </div>
          </div>
          
          {/* Throttle Indicator */}
          <div style={{ width: '100%' }}>
            <Typography variant="caption" style={{ color: Colors.white }}>
              Throttle: {localThrottle.toFixed(2)}
            </Typography>
            <div style={{
              width: '120px',
              height: '20px',
              backgroundColor: Colors.grey900,
              position: 'relative',
              borderRadius: '4px',
              overflow: 'hidden',
              marginTop: '2px'
            }}>
              <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.max(0, localThrottle) * 100}%`,
                backgroundColor: localThrottle > 0.7 ? Colors.red500 : Colors.green500,
                transition: 'width 0.015s linear' // Minimal transition
              }} />
              <div style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: `${Math.abs(Math.min(0, localThrottle)) * 100}%`,
                backgroundColor: Colors.orange500,
                transition: 'width 0.015s linear' // Minimal transition
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Video Controls */}
      <div 
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.5)',
          opacity: showControls || isFullscreen ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <IconButton 
            onClick={handlePlayPauseClick} 
            style={{ color: Colors.white }}
          >
            {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
          
          {isFullscreen && !virtualControlsEnabled && (
            <Button 
              onClick={toggleControllerOverlay}
              style={{ 
                color: Colors.white,
                backgroundColor: showControllerOverlay ? 'rgba(255,255,255,0.2)' : 'transparent',
                marginLeft: '5px',
                textTransform: 'none',
                padding: '4px 8px',
                minWidth: 'auto'
              }}
            >
              {showControllerOverlay ? "Hide Controls" : "Show Controls"}
            </Button>
          )}
        </div>

        <IconButton 
          onClick={toggleFullscreen} 
          style={{ color: Colors.white }}
        >
          {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </IconButton>
      </div>
    </div>
  );
};

export default VideoPlayer;