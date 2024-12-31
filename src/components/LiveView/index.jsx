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
import { withStyles, Typography, Button, CircularProgress, Paper, Tooltip } from '@material-ui/core';
import ResizeHandler from '../ResizeHandler';
import VisibilityHandler from '../VisibilityHandler';
import DeviceInfo from '../DeviceInfo';
import AnsiToHtml from 'ansi-to-html';
import { FixedSizeList } from 'react-window';

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

function LiveStreamContainer({ streams, handleTrackAction }) {

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

  render() {
    const { streams, loading, error, status, tmuxCaptureOutput } = this.state;
    return (
      <div style={{ padding: "20px", backgroundColor: Colors.grey900, minHeight: "100vh" }}>
  
        {<LiveViewControl state={this.state} handleConnectionToggle={this.handleConnectionToggle} sendCaptureTmux={this.sendCaptureTmux}/>}
        {loading && ( <Typography style={{ textAlign: "center", color: Colors.white }}>Loading...</Typography> )}
        {status && ( <Typography style={{ color: Colors.blue500, textAlign: "center" }}>{status}</Typography> )}
        {error && ( <Typography style={{ color: Colors.red500, textAlign: "center" }}>{error}</Typography> )}
        {tmuxCaptureOutput && ( <ResponsiveTextPaper tmuxCaptureOutput={tmuxCaptureOutput} /> )}
        {streams && ( <LiveStreamContainer streams={streams} handleTrackAction={this.handleTrackAction}/> )}
  
      </div>
    );
  }
}

const stateToProps = Obstruction({
  dongleId: 'dongleId',
  device: 'device',
});

export default connect(stateToProps)(LiveView);