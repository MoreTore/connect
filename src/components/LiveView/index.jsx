import React, { Component, useState} from 'react';
import { connect } from 'react-redux';
import Obstruction from 'obstruction';
import * as Sentry from '@sentry/react';
import 'react-responsive-carousel/lib/styles/carousel.min.css'; // requires a loader
import { Carousel } from 'react-responsive-carousel';

import adapter from 'webrtc-adapter';
import { athena as Athena } from '@moretore/api';
import { deviceNamePretty, deviceIsOnline } from '../../utils';
import VideoPlayer from "../VideoPlayer";

import Colors from '../../colors';
import { withStyles, Typography, Button, CircularProgress, Paper, Tooltip, Switch, FormControlLabel, IconButton } from '@material-ui/core';
import ResizeHandler from '../ResizeHandler';
import VisibilityHandler from '../VisibilityHandler';
import DeviceInfo from '../DeviceInfo';
import AnsiToHtml from 'ansi-to-html';
import { FixedSizeList } from 'react-window';
import FullscreenIcon from '@material-ui/icons/Fullscreen';
import FullscreenExitIcon from '@material-ui/icons/FullscreenExit';
import CloseIcon from '@material-ui/icons/Close';

const converter = new AnsiToHtml({ bg: "#2a2a2a", fg: "#f0f0f0" });

async function fetchWithRetry(fetchFn, retries, delay) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await fetchFn();
      if (result) return result; // Return if fetch succeeds
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delay)); // Delay before retry
  }
  throw new Error("All retries failed");
}


function LiveViewControl({ state, handleConnectionToggle, sendCaptureTmux }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "start",
        gap: "20px",
        alignItems: "center",
        marginBottom: "20px",
      }}
    >
      <Typography
        variant="h2" // Make the text bigger
        style={{ color: Colors.white }}
      >
        Live View
      </Typography>
      <Button
        variant="contained"
        color={state.dataChannelReady ? "primary" : "secondary"}
        disabled={state.reconnecting} // Disable button while reconnecting
        onClick={handleConnectionToggle} // Toggle connection state
        style={{
          backgroundColor: state.reconnecting ? Colors.darken60 : Colors.blue500,
          color: Colors.white,
          textTransform: "none",
        }}
      >
        {state.reconnecting ? (
          <CircularProgress size={24} style={{ color: Colors.white }} />
        ) : state.dataChannelReady ? (
          "Disconnect"
        ) : (
          "Reconnect"
        )}
      </Button>
      {/* Add the Capture Tmux button */}
      <Button
        variant="contained"
        color="secondary"
        disabled={!state.dataChannelReady} // Only enabled if data channel is ready
        onClick={sendCaptureTmux}
        style={{
          backgroundColor: state.dataChannelReady ? Colors.blue300 : Colors.grey600,
          color: Colors.white,
          textTransform: "none",
        }}
      >
        Capture Tmux
      </Button>
    </div>
  );
}

function LiveStreamContainer({ streams, handleTrackAction, controllerState, useVirtualControls, handleJoystickControl, setVideoFullscreen }) {
  return (
    <div>
    {streams.length > 0 ? (
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {streams.map((item, i) => (
          <Paper
            key={i}
            elevation={3}
            style={{
              padding: "10px",
              backgroundColor: Colors.grey800,
              borderRadius: "10px",
            }}
            >
            <Typography
              variant="h6"
              style={{ textAlign: "center", marginBottom: "10px", color: Colors.white }}
            >
              {item.label.split(":")[0]}
            </Typography>
            <VideoPlayer
              stream={item.stream}
              paused={item.paused}
              trackType={item.label.split(":")[0]} // Pass the track type (e.g., "driver", "road")
              togglePlayPause={() =>
                handleTrackAction(item.paused ? "startTrack" : "stopTrack", item.label.split(":")[0])
              }
              controllerState={controllerState}
              virtualControlsEnabled={useVirtualControls}
              handleJoystickTouch={handleJoystickControl}
              setVideoFullscreen={setVideoFullscreen}
            />
          </Paper>
        ))}
      </div>
    ) : (
      <Typography
        variant="h6"
        style={{
          textAlign: "center",
          marginTop: "20px",
          color: Colors.white60,
        }}
      >
      </Typography>
    )}
    </div>
  );
}

function ResponsiveTextPaper({ tmuxCaptureOutput }) {
  const [containerWidth, setContainerWidth] = useState(window.innerWidth);

  // Callback to handle resize events
  const handleResize = (width, height) => {
    console.log("Window resized to:", width, height); // Debug log
    setContainerWidth(width);
  };

  const lines = tmuxCaptureOutput.split("\n");

  return (
    <>
      {/* ResizeHandler to track window resizing */}
      <ResizeHandler onResize={handleResize} />

      <Paper
        style={{
          marginTop: "20px",
          padding: "10px",
          backgroundColor: "#2a2a2a",
          color: "#f0f0f0",
          borderRadius: "10px",
          maxHeight: "300px", // Let Paper control the height
          overflowY: "auto", // Scrollable Paper
          fontFamily: "monospace",
          fontSize: `clamp(14px, ${Math.min(containerWidth / 100 + 0.5, 24)}px, 24px)`, // Fix fontSize calc
        }}
        elevation={3}
      >
        <FixedSizeList
          itemCount={lines.length}
          itemSize={20} // Fixed height per item
          width="100%"
          height={lines.length * 20} // Ensure the list is auto-sized
          outerElementType="div" // Use Paper's scrolling
          innerElementType="div" // Prevent internal scrolling
          style={{ overflow: "visible" }} // Disable FixedSizeList overflow
        >
          {({ index, style }) => (
            <div
              style={{ ...style, whiteSpace: "nowrap" }}
              dangerouslySetInnerHTML={{
                __html: converter.toHtml(lines[index]),
              }}
            />
          )}
        </FixedSizeList>
      </Paper>
    </>
  );
}

// Xbox Controller Component
function XboxController({ dataChannel, dataChannelReady, controllerEnabled, setControllerEnabled, updateControllerState, useVirtualControls, setUseVirtualControls, handleJoystickControl, setVideoFullscreen }) {
  const [controllerStatus, setControllerStatus] = useState("No controller detected");
  const [controllerConnected, setControllerConnected] = useState(false);
  const [lastInputs, setLastInputs] = useState({});
  const [throttle, setThrottle] = useState(0);
  const [steering, setSteering] = useState(0);
  const [inputCounter, setInputCounter] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [invertSteering, setInvertSteering] = useState(false);
  const virtualJoystickRef = React.useRef(null);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const virtualControllerRef = React.useRef(null);
  
  // Add additional state for animation frame management
  const [animationFrameId, setAnimationFrameId] = useState(null);
  const requestRef = React.useRef();
  const previousTimeRef = React.useRef();
  
  // Add back touchState definition that was accidentally removed
  const [touchState, setTouchState] = useState({
    joystickTouch: null,
    currentSteering: 0,
    currentThrottle: 0,
    // Track the joystick center point and start position
    joystickCenter: { x: 0, y: 0 },
    mouseDown: false,
    joystickRect: null
  });
  
  // Ensure we have a valid function or a no-op function for setUseVirtualControls
  const safeSetUseVirtualControls = setUseVirtualControls || (() => console.warn("setUseVirtualControls is not available"));
  
  // Check for mobile device
  React.useEffect(() => {
    const checkIfMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      const mobileRegex = /android|iPad|iPhone|iPod|webOS|BlackBerry|Windows Phone/i;
      return mobileRegex.test(userAgent);
    };
    
    const isMobileDevice = checkIfMobile();
    setIsMobile(isMobileDevice);
    
    // If mobile, default to virtual controls but don't force it
    if (isMobileDevice) {
      // Just set mobile state, don't automatically switch to virtual controls
      // so users can choose to use Xbox controller if they want
      // safeSetUseVirtualControls(true);
    }
  }, [safeSetUseVirtualControls]);
  
  // Check for controller availability
  const checkForController = () => {
    // If using virtual controls, don't check for physical controller
    if (useVirtualControls) {
      setControllerConnected(true);
      setControllerStatus("Using virtual controls");
      return true;
    }
    
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && (
        gamepads[i].id.toLowerCase().includes('xbox') || 
        gamepads[i].id.toLowerCase().includes('xinput') ||
        gamepads[i].id.toLowerCase().includes('gamepad')
      )) {
        setControllerConnected(true);
        setControllerStatus(`Connected: ${gamepads[i].id}`);
        return true;
      }
    }
    setControllerConnected(false);
    setControllerStatus("No controller detected");
    return false;
  };

  // Add definitions for the touch handlers
  const handleJoystickTouchStart = (e) => {
    if (!controllerEnabled || !dataChannelReady) return;
    e.preventDefault(); // Prevent browser navigation
    
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    
    // Calculate the center of the joystick area
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    setTouchState(prev => ({
      ...prev,
      joystickTouch: { 
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY
      },
      joystickCenter: {
        x: centerX,
        y: centerY
      }
    }));
  };
  
  const handleJoystickTouchMove = (e) => {
    if (!touchState.joystickTouch || !controllerEnabled) return;
    e.preventDefault(); // Prevent browser navigation
    
    // Find the touch that started the joystick movement
    let touch = null;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === touchState.joystickTouch.id) {
        touch = e.touches[i];
        break;
      }
    }
    
    if (!touch) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    
    // Calculate horizontal movement for steering (left to right: -1 to 1)
    const maxHorizontalOffset = rect.width / 2;
    const horizontalOffset = touch.clientX - touchState.joystickCenter.x;
    let newSteering = horizontalOffset / maxHorizontalOffset;
    newSteering = Math.max(-1, Math.min(1, newSteering)); // Clamp between -1 and 1
    newSteering = Math.round(newSteering * 100) / 100; // Round to 2 decimal places
    
    // Calculate vertical movement for throttle/brake (down to up: -1 to 1)
    // Up is throttle (positive), down is brake (negative)
    const maxVerticalOffset = rect.height / 2;
    const verticalOffset = touchState.joystickCenter.y - touch.clientY; // Reversed because Y increases downward
    let newThrottle = verticalOffset / maxVerticalOffset;
    newThrottle = Math.max(-1, Math.min(1, newThrottle)); // Clamp between -1 and 1
    newThrottle = Math.round(newThrottle * 100) / 100; // Round to 2 decimal places
    
    setTouchState(prev => ({
      ...prev,
      currentSteering: newSteering,
      currentThrottle: newThrottle
    }));
    
    // Update the UI
    setSteering(newSteering);
    setThrottle(newThrottle);
  };
  
  const handleJoystickTouchEnd = (e) => {
    e.preventDefault(); // Prevent browser navigation
    
    // Check if the joystick touch ended
    const remainingTouchIds = Array.from(e.touches).map(t => t.identifier);
    
    if (touchState.joystickTouch && !remainingTouchIds.includes(touchState.joystickTouch.id)) {
      // Reset joystick to center position (neutral)
      setTouchState(prev => ({
        ...prev,
        joystickTouch: null,
        currentSteering: 0,
        currentThrottle: 0
      }));
      
      // Update the UI
      setSteering(0);
      setThrottle(0);
    }
  };
  
  // Mouse handlers for desktop support
  const handleJoystickMouseDown = (e) => {
    if (!controllerEnabled || !dataChannelReady) return;
    e.preventDefault(); // Prevent browser navigation
    
    const rect = e.currentTarget.getBoundingClientRect();
    
    // Calculate the center of the joystick area
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // Immediately update steering and throttle to improve responsiveness
    const maxHorizontalOffset = rect.width / 2;
    const horizontalOffset = e.clientX - centerX;
    let newSteering = horizontalOffset / maxHorizontalOffset;
    newSteering = Math.max(-1, Math.min(1, newSteering));
    newSteering = Math.round(newSteering * 100) / 100;
    
    const maxVerticalOffset = rect.height / 2;
    const verticalOffset = centerY - e.clientY;
    let newThrottle = verticalOffset / maxVerticalOffset;
    newThrottle = Math.max(-1, Math.min(1, newThrottle));
    newThrottle = Math.round(newThrottle * 100) / 100;
    
    // Update UI
    setSteering(newSteering);
    setThrottle(newThrottle);
    
    setTouchState(prev => ({
      ...prev,
      mouseDown: true,
      joystickCenter: {
        x: centerX,
        y: centerY
      },
      joystickRect: rect, // Store the joystick's dimensions
      currentSteering: newSteering,
      currentThrottle: newThrottle
    }));
  };
  
  const handleJoystickMouseMove = (e) => {
    if (!touchState.mouseDown || !controllerEnabled || !touchState.joystickRect) return;
    e.preventDefault(); // Prevent browser navigation
    
    const rect = touchState.joystickRect;
    
    // Calculate horizontal movement for steering (left to right: -1 to 1)
    const maxHorizontalOffset = rect.width / 2;
    const horizontalOffset = e.clientX - touchState.joystickCenter.x;
    let newSteering = horizontalOffset / maxHorizontalOffset;
    newSteering = Math.max(-1, Math.min(1, newSteering)); // Clamp between -1 and 1
    newSteering = Math.round(newSteering * 100) / 100; // Round to 2 decimal places
    
    // Calculate vertical movement for throttle/brake (down to up: -1 to 1)
    const maxVerticalOffset = rect.height / 2;
    const verticalOffset = touchState.joystickCenter.y - e.clientY; // Reversed because Y increases downward
    let newThrottle = verticalOffset / maxVerticalOffset;
    newThrottle = Math.max(-1, Math.min(1, newThrottle)); // Clamp between -1 and 1
    newThrottle = Math.round(newThrottle * 100) / 100; // Round to 2 decimal places
    
    // Only update the state if values changed significantly to reduce rerendering
    const threshold = 0.01;
    if (
      Math.abs(touchState.currentSteering - newSteering) > threshold || 
      Math.abs(touchState.currentThrottle - newThrottle) > threshold
    ) {
      // Update the UI immediately
      setSteering(newSteering);
      setThrottle(newThrottle);
      
      setTouchState(prev => ({
        ...prev,
        currentSteering: newSteering,
        currentThrottle: newThrottle
      }));
    }
  };
  
  const handleJoystickMouseUp = (e) => {
    e.preventDefault(); // Prevent browser navigation
    
    if (touchState.mouseDown) {
      // Reset joystick to center position (neutral)
      setTouchState(prev => ({
        ...prev,
        mouseDown: false,
        currentSteering: 0,
        currentThrottle: 0
      }));
      
      // Update the UI
      setSteering(0);
      setThrottle(0);
    }
  };
  
  // Add mouse move and up handlers to document to capture events outside the joystick
  React.useEffect(() => {
    if (useVirtualControls) {
      // Add document-level event listeners for mouse movement and release
      document.addEventListener('mousemove', handleJoystickMouseMove);
      document.addEventListener('mouseup', handleJoystickMouseUp);
      
      // Handle cases where mouse is released outside the window
      const handleBlur = () => {
        if (touchState.mouseDown) {
          // Reset joystick when focus is lost
          setTouchState(prev => ({
            ...prev,
            mouseDown: false,
            currentSteering: 0,
            currentThrottle: 0
          }));
          setSteering(0);
          setThrottle(0);
        }
      };
      
      window.addEventListener('blur', handleBlur);
      
      return () => {
        document.removeEventListener('mousemove', handleJoystickMouseMove);
        document.removeEventListener('mouseup', handleJoystickMouseUp);
        window.removeEventListener('blur', handleBlur);
      };
    }
  }, [useVirtualControls, touchState.mouseDown, controllerEnabled]);

  // Prevent Xbox controller from navigating the browser
  React.useEffect(() => {
    // This function will be called for various navigation events
    const preventDefaultForGamepad = (e) => {
      // Check if the event came from a gamepad
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents === false) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    // Prevent gamepad from triggering browser back/forward
    window.addEventListener('gamepadconnected', (e) => {
      console.log("Gamepad connected:", e.gamepad.id);
    });
    
    // Add event listeners for browser navigation events
    window.addEventListener('popstate', preventDefaultForGamepad);
    document.addEventListener('keydown', (e) => {
      // Block browser navigation keys when controller is enabled
      if (controllerEnabled && !useVirtualControls) {
        // Common navigation keys
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace', 'Escape'].includes(e.key)) {
          e.preventDefault();
        }
      }
    }, { passive: false });
    
    // Block default gamepad actions
    window.addEventListener('gamepadButtonDown', preventDefaultForGamepad, { passive: false });
    
    return () => {
      window.removeEventListener('popstate', preventDefaultForGamepad);
      window.removeEventListener('gamepadButtonDown', preventDefaultForGamepad);
      document.removeEventListener('keydown', preventDefaultForGamepad);
    };
  }, [controllerEnabled, useVirtualControls]);

  // Add keyboard controls for accessibility
  React.useEffect(() => {
    if (!useVirtualControls || !controllerEnabled || !dataChannelReady) return;
    
    const keyValues = {
      // Arrow keys
      ArrowUp: { throttle: 1, steering: 0 },
      ArrowDown: { throttle: -1, steering: 0 },
      ArrowLeft: { throttle: 0, steering: -1 },
      ArrowRight: { throttle: 0, steering: 1 },
      // WASD keys
      KeyW: { throttle: 1, steering: 0 },
      KeyS: { throttle: -1, steering: 0 },
      KeyA: { throttle: 0, steering: -1 },
      KeyD: { throttle: 0, steering: 1 }
    };
    
    // Track which keys are currently pressed
    const pressedKeys = {
      ArrowUp: false,
      ArrowDown: false,
      ArrowLeft: false, 
      ArrowRight: false,
      KeyW: false,
      KeyS: false,
      KeyA: false,
      KeyD: false
    };
    
    const updateControlsFromKeys = () => {
      let newThrottle = 0;
      let newSteering = 0;
      
      // Process vertical movement (throttle/brake)
      if ((pressedKeys.ArrowUp || pressedKeys.KeyW) && !(pressedKeys.ArrowDown || pressedKeys.KeyS)) {
        newThrottle = 1;
      } else if ((pressedKeys.ArrowDown || pressedKeys.KeyS) && !(pressedKeys.ArrowUp || pressedKeys.KeyW)) {
        newThrottle = -1;
      }
      
      // Process horizontal movement (steering)
      if ((pressedKeys.ArrowLeft || pressedKeys.KeyA) && !(pressedKeys.ArrowRight || pressedKeys.KeyD)) {
        newSteering = -1;
      } else if ((pressedKeys.ArrowRight || pressedKeys.KeyD) && !(pressedKeys.ArrowLeft || pressedKeys.KeyA)) {
        newSteering = 1;
      }
      
      // NOTE: We don't apply inversion here to the visual display
      // Inversion is applied in the sendControlInputs function
      
      // Update the UI and send controls
      setSteering(newSteering);
      setThrottle(newThrottle);
      
      setTouchState(prev => ({
        ...prev,
        currentSteering: newSteering,
        currentThrottle: newThrottle
      }));
    };
    
    const handleKeyDown = (e) => {
      // Map key code to our expected format
      const keyCode = e.code || e.key;
      
      if (keyValues[keyCode] && !pressedKeys[keyCode]) {
        e.preventDefault();
        pressedKeys[keyCode] = true;
        updateControlsFromKeys();
      }
    };
    
    const handleKeyUp = (e) => {
      // Map key code to our expected format
      const keyCode = e.code || e.key;
      
      if (keyValues[keyCode]) {
        e.preventDefault();
        pressedKeys[keyCode] = false;
        updateControlsFromKeys();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [useVirtualControls, controllerEnabled, dataChannelReady, invertSteering]);

  // Update effect to call updateControllerState when relevant values change
  React.useEffect(() => {
    if (updateControllerState) {
      // Send the current values immediately to ensure responsive display
      updateControllerState(steering, throttle, invertSteering);
    }
  }, [steering, throttle, invertSteering, updateControllerState]);

  // Function to send control inputs to the server
  const sendControlInputs = (steeringValue, throttleValue) => {
    if (!controllerEnabled || !dataChannelReady || !dataChannel) return;
    
    // Round to 2 decimal places
    steeringValue = Math.round(steeringValue * 100) / 100;
    throttleValue = Math.round(throttleValue * 100) / 100;
    
    // Apply steering inversion if enabled
    const finalSteeringValue = invertSteering ? -steeringValue : steeringValue;
    
    // Check if the values have significantly changed to avoid flooding updates
    const lastSteering = lastInputs.steering || 0;
    const lastThrottle = lastInputs.throttle || 0;
    
    // Only send updates if values changed significantly or it's been a while since last update
    const threshold = 0.01;
    if (
      Math.abs(lastSteering - finalSteeringValue) > threshold ||
      Math.abs(lastThrottle - throttleValue) > threshold
    ) {
      // Always send the current values at every call, no conditionals
      const controlData = {
        action: "controller",
        throttle: throttleValue,
        steering: finalSteeringValue,
        timestamp: Date.now()
      };
      
      try {
        dataChannel.send(JSON.stringify(controlData));
        
        // Store the sent values for comparison
        setLastInputs({ 
          throttle: throttleValue, 
          steering: finalSteeringValue,
          // Also store the non-inverted steering for display purposes
          displaySteering: steeringValue
        });
      } catch (err) {
        console.error("Error sending controller data:", err);
      }
    }
    
    // Always update the controller state in parent component
    // This ensures the fullscreen overlay stays in sync
    if (updateControllerState) {
      updateControllerState(steeringValue, throttleValue, invertSteering);
    }
  };

  // Handle controller input from physical controller
  const handleControllerInput = () => {
    if (!controllerEnabled || !dataChannelReady || !dataChannel || useVirtualControls) return;
    
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let controllerFound = false;
    
    for (let i = 0; i < gamepads.length; i++) {
      if (!gamepads[i]) continue;
      
      // Found a gamepad
      controllerFound = true;
      const gamepad = gamepads[i];
      
      // Get controller inputs
      // Left stick X (steering): axes[0], -1 (left) to 1 (right)
      // Right trigger (throttle): buttons[7].value, 0 to 1
      // Left trigger (brake): buttons[6].value, 0 to 1
      
      // Calculate steering: left stick X-axis
      let steeringValue = gamepad.axes[0];
      // Apply deadzone to reduce noise when stick is near center
      if (Math.abs(steeringValue) < 0.1) steeringValue = 0;
      
      // Calculate throttle from right trigger (RT)
      // Xbox controllers use buttons[7] for RT
      let throttleValue = 0;
      if (gamepad.buttons && gamepad.buttons.length > 7) {
        throttleValue = gamepad.buttons[7].value || 0;
      }
      
      // Calculate brake from left trigger (LT)
      // Xbox controllers use buttons[6] for LT
      let brakeValue = 0;
      if (gamepad.buttons && gamepad.buttons.length > 6) {
        brakeValue = gamepad.buttons[6].value || 0;
      }
      
      // Calculate final throttle (throttle - brake)
      let finalThrottle = throttleValue - brakeValue;
      
      // The visual display doesn't need inversion, only the sent value
      // so we don't apply inversion here
      
      // Update state (for UI display)
      setSteering(steeringValue);
      setThrottle(finalThrottle);
      
      // Send the control inputs (inversion will be applied in sendControlInputs)
      sendControlInputs(steeringValue, finalThrottle);
      
      break; // Only use the first valid controller
    }
    
    if (controllerConnected !== controllerFound && !useVirtualControls) {
      setControllerConnected(controllerFound);
      checkForController();
      
      // If controller disconnected on mobile, suggest virtual controls
      if (!controllerFound && isMobile) {
        setControllerStatus("Controller disconnected. Consider using virtual controls.");
      }
    }
  };

  // Set up controller detection and polling
  React.useEffect(() => {
    // Initial controller check
    checkForController();
    
    // Handle controller connect/disconnect events if not using virtual controls
    const handleControllerConnected = () => {
      console.log("Controller connected!");
      checkForController();
    };
    
    const handleControllerDisconnected = () => {
      console.log("Controller disconnected!");
      checkForController();
      
      // If on mobile and controller disconnects, suggest virtual controls
      if (isMobile) {
        setControllerStatus("Controller disconnected. Consider using virtual controls.");
      }
    };
    
    window.addEventListener("gamepadconnected", handleControllerConnected);
    window.addEventListener("gamepaddisconnected", handleControllerDisconnected);
    
    // Set up input polling if enabled
    let inputInterval = null;
    
    if (controllerEnabled) {
      // Higher polling rate for more responsive controls
      const pollRate = 10; // 100Hz
      
      if (useVirtualControls) {
        // For desktop browser, use requestAnimationFrame for smoother performance
        const animate = time => {
          if (previousTimeRef.current === undefined) {
            previousTimeRef.current = time;
          }
          
          const deltaTime = time - previousTimeRef.current;
          // Limit to ~100Hz but ensure we run on every frame
          if (deltaTime > 8) { 
            previousTimeRef.current = time;
            // Only send if values are non-zero or changed
            if (touchState.currentSteering !== 0 || touchState.currentThrottle !== 0 ||
                lastInputs.displaySteering !== 0 || lastInputs.throttle !== 0) {
              sendControlInputs(touchState.currentSteering, touchState.currentThrottle);
            }
          }
          
          requestRef.current = requestAnimationFrame(animate);
        };
        
        if (!isMobile) {
          // Use requestAnimationFrame for desktop (smoother)
          requestRef.current = requestAnimationFrame(animate);
        } else {
          // Use interval for mobile (more consistent)
          inputInterval = setInterval(() => {
            // Only send if values are non-zero or changed
            if (touchState.currentSteering !== 0 || touchState.currentThrottle !== 0 ||
                lastInputs.displaySteering !== 0 || lastInputs.throttle !== 0) {
              sendControlInputs(touchState.currentSteering, touchState.currentThrottle);
            }
          }, pollRate);
        }
      } else {
        // For physical controllers
        inputInterval = setInterval(() => {
          handleControllerInput();
        }, pollRate);
      }
    }
    
    // Cleanup
    return () => {
      window.removeEventListener("gamepadconnected", handleControllerConnected);
      window.removeEventListener("gamepaddisconnected", handleControllerDisconnected);
      if (inputInterval) clearInterval(inputInterval);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [controllerEnabled, dataChannelReady, dataChannel, useVirtualControls, touchState, isMobile, updateControllerState, lastInputs]);

  // Handle entering fullscreen mode
  const enterFullscreen = () => {
    setFullscreenMode(true);
    document.body.style.overflow = 'hidden'; // Prevent scrolling when in fullscreen
  };

  // Handle exiting fullscreen mode
  const exitFullscreen = () => {
    setFullscreenMode(false);
    document.body.style.overflow = ''; // Restore normal scrolling
  };

  // Render the virtual controller UI
  const renderVirtualController = () => {
    // Create dynamic style based on input type
    const joystickThumbStyle = {
      position: "absolute",
      left: `${50 + steering * 50}%`,
      top: `${50 - throttle * 50}%`,
      transform: "translate(-50%, -50%)",
      width: fullscreenMode ? "60px" : "40px", // Make thumb larger in fullscreen
      height: fullscreenMode ? "60px" : "40px",
      borderRadius: "50%",
      backgroundColor: Colors.blue500,
      border: "3px solid white"
    };
    
    // Only add transition for mobile devices
    if (isMobile) {
      joystickThumbStyle.transition = "left 0.1s ease-out, top 0.1s ease-out";
    }

    if (fullscreenMode) {
      // Render fullscreen version
      return (
        <div 
          ref={virtualControllerRef}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            backgroundColor: Colors.grey900,
            display: "flex",
            flexDirection: "column",
            paddingTop: "20px"
          }}
        >
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center", 
            padding: "0 20px 20px 20px" 
          }}>
            <Typography variant="h5" style={{ color: Colors.white }}>
              Virtual Controller {invertSteering && <span style={{ color: Colors.orange500 }}>(Steering Inverted)</span>}
            </Typography>
            
            <div>
              <FormControlLabel
                control={
                  <Switch
                    checked={invertSteering}
                    onChange={(e) => setInvertSteering(e.target.checked)}
                    color="secondary"
                    size="small"
                  />
                }
                label={<Typography style={{ color: Colors.white }}>Invert Steering</Typography>}
              />
              <IconButton 
                onClick={exitFullscreen}
                style={{ color: Colors.white }}
              >
                <CloseIcon />
              </IconButton>
            </div>
          </div>
          
          {/* Single Joystick Control - Fullscreen Version */}
          <div 
            style={{
              flex: 1,
              backgroundColor: Colors.grey800,
              position: "relative",
              touchAction: "none",
              cursor: "grab"
            }}
            onTouchStart={handleJoystickTouchStart}
            onTouchMove={handleJoystickTouchMove}
            onTouchEnd={handleJoystickTouchEnd}
            onTouchCancel={handleJoystickTouchEnd}
            onMouseDown={handleJoystickMouseDown}
          >
            {/* Joystick background lines */}
            <div style={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: "2px",
              backgroundColor: Colors.white30
            }} />
            <div style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              height: "2px",
              backgroundColor: Colors.white30
            }} />
            
            {/* Joystick thumb */}
            <div style={joystickThumbStyle} />
            
            {/* Labels - bigger in fullscreen */}
            <div style={{
              position: "absolute", 
              left: "20px", 
              top: "50%",
              transform: "translateY(-50%)",
              color: Colors.white60,
              fontSize: "24px"
            }}>
              {invertSteering ? "RIGHT" : "LEFT"}
            </div>
            <div style={{
              position: "absolute", 
              right: "20px", 
              top: "50%",
              transform: "translateY(-50%)",
              color: Colors.white60,
              fontSize: "24px"
            }}>
              {invertSteering ? "LEFT" : "RIGHT"}
            </div>
            <div style={{
              position: "absolute", 
              left: "50%", 
              top: "20px",
              transform: "translateX(-50%)",
              color: Colors.green500,
              fontSize: "24px"
            }}>
              THROTTLE
            </div>
            <div style={{
              position: "absolute", 
              left: "50%", 
              bottom: "20px",
              transform: "translateX(-50%)",
              color: Colors.orange500,
              fontSize: "24px"
            }}>
              BRAKE
            </div>
          </div>
          
          {/* Control values display */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "20px" }}>
            <Typography style={{ color: Colors.white, fontSize: "18px" }}>
              Steering: {steering.toFixed(2)}
            </Typography>
            <Typography style={{ color: Colors.white, fontSize: "18px" }}>
              Throttle: {throttle.toFixed(2)}
            </Typography>
          </div>
        </div>
      );
    }
    
    // Regular non-fullscreen version
    return (
      <div style={{ marginTop: "15px" }} ref={virtualControllerRef}>
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center", 
          marginBottom: "10px" 
        }}>
          <Typography style={{ color: Colors.white, textAlign: "center" }}>
            Virtual Controller {invertSteering && <span style={{ color: Colors.orange500 }}>(Steering Inverted)</span>}
          </Typography>
          
          <div style={{ display: "flex", alignItems: "center" }}>
            <FormControlLabel
              control={
                <Switch
                  checked={invertSteering}
                  onChange={(e) => setInvertSteering(e.target.checked)}
                  color="secondary"
                  size="small"
                />
              }
              label={<Typography style={{ color: Colors.white }}>Invert</Typography>}
            />
            
            <IconButton 
              onClick={enterFullscreen}
              style={{ color: Colors.white }}
              size="small"
            >
              <FullscreenIcon />
            </IconButton>
          </div>
        </div>
        
        {/* Single Joystick Control */}
        <div 
          style={{
            width: "100%",
            height: "200px",
            backgroundColor: Colors.grey900,
            borderRadius: "10px",
            position: "relative",
            touchAction: "none",
            marginBottom: "10px",
            cursor: "grab"
          }}
          onTouchStart={handleJoystickTouchStart}
          onTouchMove={handleJoystickTouchMove}
          onTouchEnd={handleJoystickTouchEnd}
          onTouchCancel={handleJoystickTouchEnd}
          onMouseDown={handleJoystickMouseDown}
        >
          {/* Joystick background lines */}
          <div style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: "2px",
            backgroundColor: Colors.white30
          }} />
          <div style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            height: "2px",
            backgroundColor: Colors.white30
          }} />
          
          {/* Joystick thumb - with conditional transition */}
          <div style={joystickThumbStyle} />
          
          {/* Labels */}
          <div style={{
            position: "absolute", 
            left: "10px", 
            top: "50%",
            transform: "translateY(-50%)",
            color: Colors.white60
          }}>
            {invertSteering ? "RIGHT" : "LEFT"}
          </div>
          <div style={{
            position: "absolute", 
            right: "10px", 
            top: "50%",
            transform: "translateY(-50%)",
            color: Colors.white60
          }}>
            {invertSteering ? "LEFT" : "RIGHT"}
          </div>
          <div style={{
            position: "absolute", 
            left: "50%", 
            top: "10px",
            transform: "translateX(-50%)",
            color: Colors.green500
          }}>
            THROTTLE
          </div>
          <div style={{
            position: "absolute", 
            left: "50%", 
            bottom: "10px",
            transform: "translateX(-50%)",
            color: Colors.orange500
          }}>
            BRAKE
          </div>
        </div>
        
        {/* Control values display */}
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Typography style={{ color: Colors.white }}>
            Steering: {steering.toFixed(2)}
          </Typography>
          <Typography style={{ color: Colors.white }}>
            Throttle: {throttle.toFixed(2)}
          </Typography>
        </div>
        
        <Typography style={{ color: Colors.white60, fontSize: "0.8rem", textAlign: "center", marginTop: "5px" }}>
          {isMobile ? 
            "Touch and drag to control. Left/right = steering, up/down = throttle/brake" :
            "Click and drag to control. Left/right = steering, up/down = throttle/brake"
          }
        </Typography>
        
        {!isMobile && (
          <Typography style={{ color: Colors.white60, fontSize: "0.8rem", textAlign: "center", marginTop: "5px" }}>
            Keyboard: Arrow keys or WASD for steering and throttle
          </Typography>
        )}
      </div>
    );
  };

  // Add a handler to pass joystick controls up to parent
  const handleJoystickInput = (newSteering, newThrottle) => {
    // Update local state
    setSteering(newSteering);
    setThrottle(newThrottle);
    
    // Pass to parent function if exists
    if (handleJoystickControl) {
      handleJoystickControl(newSteering, newThrottle);
    }
    
    // Send to server
    sendControlInputs(newSteering, newThrottle);
  };

  return (
    <Paper
      elevation={3}
      style={{
        marginTop: "20px",
        padding: "15px",
        backgroundColor: Colors.grey800,
        borderRadius: "10px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <Typography variant="h6" style={{ color: Colors.white }}>
          {useVirtualControls ? "Virtual Controller" : "Xbox Controller"}
        </Typography>
        <div style={{ display: "flex", alignItems: "center" }}>
          <FormControlLabel
            control={
              <Switch
                checked={useVirtualControls}
                onChange={(e) => safeSetUseVirtualControls(e.target.checked)}
                color="secondary"
              />
            }
            label={<Typography style={{ color: Colors.white, marginRight: "15px" }}>Virtual</Typography>}
          />
          {!useVirtualControls && (
            <FormControlLabel
              control={
                <Switch
                  checked={invertSteering}
                  onChange={(e) => setInvertSteering(e.target.checked)}
                  color="secondary"
                  size="small"
                />
              }
              label={<Typography style={{ color: Colors.white, marginRight: "15px" }}>Invert</Typography>}
            />
          )}
          <FormControlLabel
            control={
              <Switch
                checked={controllerEnabled}
                onChange={(e) => setControllerEnabled(e.target.checked)}
                color="primary"
              />
            }
            label={<Typography style={{ color: Colors.white }}>Enable</Typography>}
          />
        </div>
      </div>
      
      <Typography style={{ 
        color: controllerConnected ? Colors.green500 : Colors.red500,
        marginBottom: "10px" 
      }}>
        Status: {controllerStatus} {controllerConnected && invertSteering && !useVirtualControls && <span style={{ color: Colors.orange500 }}>(Steering Inverted)</span>}
      </Typography>
      
      {/* Main Controller UI */}
      {controllerConnected && controllerEnabled && !useVirtualControls && (
        <div>
          <div style={{ display: "flex", marginBottom: "5px" }}>
            <Typography style={{ color: Colors.white, width: "80px" }}>Steering:</Typography>
            <div style={{
              flex: 1,
              height: "20px",
              backgroundColor: Colors.grey900,
              position: "relative",
              borderRadius: "4px",
              overflow: "hidden"
            }}>
              <div style={{
                position: "absolute",
                left: "50%",
                top: 0,
                bottom: 0,
                width: "2px",
                backgroundColor: Colors.white30
              }} />
              <div style={{
                position: "absolute",
                left: `${50 + steering * 50}%`,
                top: 0,
                bottom: 0,
                width: "10px",
                backgroundColor: Math.abs(steering) > 0.7 ? Colors.red500 : Colors.blue500,
                transform: "translateX(-50%)",
                transition: "left 0.1s ease-out"
              }} />
            </div>
          </div>
          
          <div style={{ display: "flex" }}>
            <Typography style={{ color: Colors.white, width: "80px" }}>Throttle:</Typography>
            <div style={{
              flex: 1,
              height: "20px",
              backgroundColor: Colors.grey900,
              position: "relative",
              borderRadius: "4px",
              overflow: "hidden"
            }}>
              <div style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.max(0, throttle) * 100}%`,
                backgroundColor: throttle > 0.7 ? Colors.red500 : Colors.green500,
                transition: "width 0.1s ease-out"
              }} />
              <div style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: `${Math.abs(Math.min(0, throttle)) * 100}%`,
                backgroundColor: Colors.orange500,
                transition: "width 0.1s ease-out"
              }} />
            </div>
          </div>
          
          {isMobile && (
            <Typography style={{ 
              color: Colors.yellow500, 
              backgroundColor: Colors.grey900,
              padding: "8px",
              borderRadius: "5px",
              fontSize: "0.9rem",
              marginTop: "10px",
              display: "flex",
              alignItems: "center"
            }}>
              <span style={{ marginRight: "5px" }}>⚠️</span>
              <span>If your controller causes navigation issues, try tapping the screen once first.</span>
            </Typography>
          )}
        </div>
      )}
      
      {/* Virtual Controller UI - only show when using virtual controls */}
      {controllerEnabled && useVirtualControls && renderVirtualController()}
      
      {/* Instructions for connecting physical controllers */}
      {!controllerConnected && !useVirtualControls && (
        <div>
          <Typography style={{ color: Colors.white60, marginBottom: "10px" }}>
            Connect an Xbox controller to use this feature
          </Typography>
          
          <Typography style={{ 
            color: Colors.yellow500, 
            backgroundColor: Colors.grey900,
            padding: "8px",
            borderRadius: "5px",
            fontSize: "0.9rem",
            display: "flex",
            alignItems: "center"
          }}>
            <span style={{ marginRight: "5px" }}>⚠️</span>
            <span>Important: Press any button on your controller after connecting to activate it</span>
          </Typography>
          
          {isMobile && (
            <Typography style={{ 
              color: Colors.yellow500, 
              backgroundColor: Colors.grey900,
              padding: "8px",
              borderRadius: "5px",
              fontSize: "0.9rem",
              marginTop: "10px",
              display: "flex",
              alignItems: "center"
            }}>
              <span style={{ marginRight: "5px" }}>ℹ️</span>
              <span>Make sure your controller is paired with your device before enabling.</span>
            </Typography>
          )}
          
          <Button
            variant="contained"
            color="secondary"
            fullWidth
            style={{ marginTop: "15px" }}
            onClick={() => safeSetUseVirtualControls(true)}
          >
            Use Virtual Controller Instead
          </Button>
        </div>
      )}
      
      {(!controllerConnected && useVirtualControls && !controllerEnabled) && (
        <Typography style={{ color: Colors.white60 }}>
          Enable controller to start using virtual controls
        </Typography>
      )}
    </Paper>
  );
}

class LiveView extends Component {
  constructor(props) {
    super(props);
    this.state = {
      windowWidth: window.innerWidth,
      streams: [],
      rtcConnection: null,
      dataChannelReady: false,
      tmuxCaptureOutput: "",
      reconnecting: false,
      loading: false,
      sdpOffer: null,
      error: null,
      status: null,
      lines: "",
      controllerEnabled: false,
      controllerState: { steering: 0, throttle: 0, invertSteering: false },
      useVirtualControls: false,
      videoFullscreen: false,
    };
  }

  componentDidMount() {
    this.setupRTCConnection();
  }

  componentWillUnmount() {
    this.disconnectRTCConnection();
  }

  componentDidUpdate(prevProps, prevState) {
    const { dongleId } = this.props;

    if (prevState.tmuxCaptureOutput !== this.state.tmuxCaptureOutput) {
      this.setState({
        lines: this.state.tmuxCaptureOutput.split("\n"),
      });
    }

    if (prevProps.dongleId !== dongleId) {
      this.disconnectRTCConnection();
      this.setupRTCConnection();
      this.setState({
        windowWidth: window.innerWidth,
      });
    }
  }

  async fetchDeviceSdpOffer() {
    const { dongleId, device } = this.props;
    if (!deviceIsOnline(device)) {
      console.error("Device is offline");
      this.setState({ error: "Device is offline. Check connections"});
      return null;
    }

    try {
      const payload = {
        method: 'getSdp',
        jsonrpc: '2.0',
        id: 0,
      };
      const resp = await Athena.postJsonRpcPayload(dongleId, payload);
      return resp.result;
    } catch (err) {
      console.error("Error fetching SDP offer:", err);
      this.setState({ error: "Failed to fetch SDP offer." });
      return null;
    }
  }

  async sendSdpAnswer(answer) {
    const { dongleId, device } = this.props;
    if (!deviceIsOnline(device)) {
      console.error("Device is offline");
      return false;
    }

    try {
      const payload = {
        method: 'setSdpAnswer',
        params: { answer },
        jsonrpc: '2.0',
        id: 0,
      };
      const resp = await Athena.postJsonRpcPayload(dongleId, payload);

      return resp.result !== null;
    } catch (err) {
      console.error("Error sending SDP answer:", err);
      this.setState({ error: "Failed to send SDP answer." });
      return false;
    }
  }

  async fetchAndAddIceCandidates() {
    const { dongleId } = this.props;
  
    try {
      const payload = {
        method: 'getIce',
        jsonrpc: '2.0',
        id: 0,
      };
  
      // Fetch ICE candidates from the sender
      const response = await Athena.postJsonRpcPayload(dongleId, payload);
  
      if (response && response.result && Array.isArray(response.result)) {
        for (const candidate of response.result) {
          await this.state.rtcConnection.addIceCandidate(new RTCIceCandidate(candidate));
          console.log("Added ICE candidate:", candidate);
        }
      }
    } catch (err) {
      console.error("Error fetching or adding ICE candidates:", err);
    }
  }

  async setupRTCConnection() {
    const { dongleId } = this.props;
    const { rtcConnection } = this.state;

    if (!dongleId) {
      this.setState({ error: "No dongle ID provided." });
      return;
    }

    if (rtcConnection) {
      this.disconnectRTCConnection();
    }

    this.setState({ reconnecting: true, error: null });
    this.setState({ loading: true });
    
    const payload = {
      method: 'setSdpAnswer',
      params: { answer: {"type": "start"} },
      jsonrpc: '2.0',
      id: 0,
    };

    const resp = await Athena.postJsonRpcPayload(dongleId, payload);
    if (resp == null) {
      console.log("Failed to send start signal to device.")
    }

    try {
      const rtcConnection = new RTCPeerConnection(
        {
          iceServers: [
            {
              urls: "turn:85.190.241.173:3478",
              username: "testuser",
              credential: "testpass",
            },
            {
              urls: ["stun:85.190.241.173:3478", "stun:stun.l.google.com:19302"]
            }
          ],
          iceTransportPolicy: "all",
        }
      );

      // Handle incoming tracks
      rtcConnection.ontrack = (event) => {
        const newTrack = event.track;
        // Instead of using event.streams, create a new MediaStream for each track
        const newStream = new MediaStream([newTrack]);
        
        this.setState((prevState) => ({
          streams: [...prevState.streams, { stream: newStream, label: newTrack.label }]
        }));
      };

      rtcConnection.onicecandidate = (event) => {
        console.log("ICE candidate:", event.candidate);
        if (event.candidate && (event.candidate.type === 'relay')) {
          this.sendSdpAnswer({type: 'candidate' , candidate: event.candidate});
        }
      };

      rtcConnection.oniceconnectionstatechange = () => {
        console.log("ICE Connection State:", rtcConnection.iceConnectionState);
        if (['connected', 'completed'].includes(rtcConnection.iceConnectionState)) {
          this.setState({ status: null, error: null});
        } else if (['failed', 'disconnected'].includes(rtcConnection.iceConnectionState)) {
          this.setState({ status: null, error: "Connection failed"});
        }
      };

      // Handle data channel created by the sender
      rtcConnection.ondatachannel = (event) => {
        const dataChannel = event.channel;
        console.log("Data channel received:", dataChannel);

        dataChannel.onopen = () => {
          console.log("Data channel is open");
          this.setState({ dataChannel, dataChannelReady: true });
        };

        dataChannel.onclose = () => {
          console.log("Data channel closed");
          this.setState({ dataChannelReady: false });
        };

        dataChannel.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log("Received message on data channel:", message);

            if (message.tmuxCapture) {
              this.setState({ tmuxCaptureOutput: message.tmuxCapture });
            }
        
            if (message.trackState) {
              const updatedTrackStates = message.trackState;
        
              // Update React state with the new track states
              this.setState((prevState) => {
                const updatedStreams = prevState.streams.map((stream) => {
                  const trackLabel = stream.label.split(":")[0]; // Example: 'driver'
                  return {
                    ...stream,
                    paused: updatedTrackStates[trackLabel] ?? stream.paused, // Update only if data is available
                  };
                });
                return { streams: updatedStreams };
              });
            }


          } catch (error) {
            console.error("Error parsing data channel message:", error);
          }
        };
      };

      this.setState({ status: "Fetching connection description from remote device."})
      const offerResponse = await this.fetchDeviceSdpOffer();
      if (!offerResponse || offerResponse.type !== 'offer') {
        this.setState({ error: "Failed to connect to the device. Check device connection." });
        return;
      }

      try {
        await rtcConnection.setRemoteDescription(new RTCSessionDescription(offerResponse));
      } catch (err) {
        console.error("Failed to set remote description:", err);
        this.setState({ error: "Recieved an invalid connection discription from the device." });
        return;
      }

      const answer = await rtcConnection.createAnswer();
      await rtcConnection.setLocalDescription(answer);
      
      await new Promise((resolve) => {
        if (rtcConnection.iceGatheringState === 'complete') {
          resolve();
        } else {
          rtcConnection.addEventListener('icegatheringstatechange', () => {
            console.log("icegatheringstatechange", rtcConnection.iceGatheringState);
            if (rtcConnection.iceGatheringState === 'complete') {
              this.setState({ error: null });
              resolve();
            }
            if (rtcConnection.iceGatheringState === 'gathering') {
              this.setState({ status: "Looking for a direct connection to the device" });
            }
          });
        }
      });

      const answerSent = await this.sendSdpAnswer(answer);
      if (!answerSent) {
        console.error("Failed to send SDP answer");
        this.setState({ error: "Failed to send SDP answer." });
        return;
      }

      this.setState({ rtcConnection, reconnecting: false, loading: false });
    } catch (error) {
      console.error("RTC setup failed:", error);
      this.setState({ error: "Failed to set up RTC connection.", reconnecting: false, loading: false });
    }
  }

  handleTrackAction = (action, trackType) => {
    const { dataChannel, dataChannelReady } = this.state;
  
    if (!dataChannelReady || !dataChannel) {
      console.error("Data channel is not ready to send messages.");
      return;
    }
  
    if (!trackType) {
      console.error("Invalid track type.");
      return;
    }
  
    const message = JSON.stringify({
      action: action,
      trackType: trackType,
    });
  
    dataChannel.send(message);
    console.log(`${action} request sent for track: ${trackType}`);
  };

  togglePlayPause = () => {
    const { playing } = this.state;
    const { handleTrackAction, trackType } = this.props;

    if (playing) {
      // Send stop command to the server
      handleTrackAction("stopTrack", trackType);
    } else {
      // Send start command to the server
      handleTrackAction("startTrack", trackType);
    }

    this.setState({ playing: !playing });
  };

  disconnectRTCConnection = () => {
    const { rtcConnection } = this.state;
  
    if (rtcConnection) {
      console.log("Disconnecting existing RTC connection...");
      rtcConnection.close();
      this.setState({ rtcConnection: null, dataChannel: null, dataChannelReady: false, streams: [] });
    }
  };

  handleConnectionToggle = () => {
    const { dataChannelReady } = this.state;
  
    if (dataChannelReady) {
      // Disconnect if currently connected
      this.disconnectRTCConnection();
    } else {
      // Reconnect if not connected
      this.setupRTCConnection();
    }
  };

  sendCaptureTmux = () => {
    const { dataChannel, dataChannelReady } = this.state;
    if (dataChannelReady && dataChannel) {
      const message = JSON.stringify({ action: "captureTmux" });
      dataChannel.send(message);
      console.log("captureTmux command sent.");
    }
  };

  setControllerEnabled = (enabled) => {
    this.setState({ controllerEnabled: enabled });
  }

  // Add a new method to update controller state
  updateControllerState = (steering, throttle, invertSteering) => {
    this.setState({
      controllerState: { steering, throttle, invertSteering }
    });
  }

  // Add a handler for joystick control from fullscreen view
  handleJoystickControl = (steering, throttle) => {
    // Send control data via data channel
    if (this.state.dataChannelReady && this.state.dataChannel) {
      const controlData = {
        action: "controller",
        throttle: throttle,
        steering: this.state.controllerState.invertSteering ? -steering : steering,
        timestamp: Date.now()
      };
      
      try {
        this.state.dataChannel.send(JSON.stringify(controlData));
      } catch (err) {
        console.error("Error sending controller data from video view:", err);
      }
    }
  }

  // Add method to update fullscreen state
  setVideoFullscreen = (isFullscreen) => {
    this.setState({ videoFullscreen: isFullscreen });
  }

  render() {
    const { 
      streams, 
      loading, 
      error, 
      status, 
      tmuxCaptureOutput, 
      dataChannel, 
      dataChannelReady, 
      controllerEnabled, 
      controllerState,
      useVirtualControls,
      videoFullscreen
    } = this.state;
    
    return (
      <div style={{ padding: "20px", backgroundColor: Colors.grey900, minHeight: "100vh" }}>
  
        {<LiveViewControl state={this.state} handleConnectionToggle={this.handleConnectionToggle} sendCaptureTmux={this.sendCaptureTmux}/>}
        {loading && ( <Typography style={{ textAlign: "center", color: Colors.white }}>Loading...</Typography> )}
        {status && ( <Typography style={{ color: Colors.blue500, textAlign: "center" }}>{status}</Typography> )}
        {error && ( <Typography style={{ color: Colors.red500, textAlign: "center" }}>{error}</Typography> )}
        {tmuxCaptureOutput && ( <ResponsiveTextPaper tmuxCaptureOutput={tmuxCaptureOutput} /> )}
        
        {/* Always render XboxController but hide it visually when in fullscreen mode */}
        {dataChannelReady && (
          <div style={{ display: videoFullscreen ? 'none' : 'block' }}>
            <XboxController 
              dataChannel={dataChannel} 
              dataChannelReady={dataChannelReady} 
              controllerEnabled={controllerEnabled}
              setControllerEnabled={this.setControllerEnabled}
              updateControllerState={this.updateControllerState}
              useVirtualControls={useVirtualControls}
              setUseVirtualControls={(value) => this.setState({ useVirtualControls: value })}
              handleJoystickControl={this.handleJoystickControl}
              setVideoFullscreen={this.setVideoFullscreen}
            />
          </div>
        )}
        
        {streams && ( 
          <LiveStreamContainer 
            streams={streams} 
            handleTrackAction={this.handleTrackAction} 
            controllerState={controllerState}
            useVirtualControls={useVirtualControls}
            handleJoystickControl={this.handleJoystickControl}
            setVideoFullscreen={this.setVideoFullscreen}
          /> 
        )}
  
      </div>
    );
  }
}

const stateToProps = Obstruction({
  dongleId: 'dongleId',
  device: 'device',
});

export default connect(stateToProps)(LiveView);