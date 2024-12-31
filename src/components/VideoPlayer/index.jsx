import React, { Component } from "react";
import { Button } from "@material-ui/core";
import Colors from "../../colors";

class VideoPlayer extends Component {
  constructor(props) {
    super(props);
    this.videoRef = React.createRef();
  }

  componentDidMount() {
    // Attach the video stream to the video element
    if (this.videoRef.current && this.props.stream) {
      console.log("Attaching stream to video element:", this.props.stream);
      this.videoRef.current.srcObject = this.props.stream;
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.stream !== this.props.stream && this.props.stream) {
      console.log("Attaching new stream to video element:", this.props.stream);
      this.videoRef.current.srcObject = this.props.stream;
      if (!this.props.paused) {
        this.videoRef.current.play().catch((error) => {
          console.error("Error playing video:", error);
        });
      }
    }

    if (prevProps.paused !== this.props.paused) {
      if (this.props.paused) {
        this.videoRef.current.pause();
      } else {
        this.videoRef.current.play().catch((error) => {
          console.error("Error playing video:", error);
        });
      }
    }
  }

  render() {
    const { paused, togglePlayPause } = this.props;

    return (
      <div
        style={{
          position: "relative",
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        <video
          ref={this.videoRef}
          autoPlay
          playsInline
          muted
          controls={false}
          style={{
            width: "100%",
            borderRadius: "10px",
            backgroundColor: Colors.black,
          }}
        />

        {/* Play/Pause Button */}
        <div
          style={{
            position: "absolute",
            bottom: "10px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: Colors.darken60,
            borderRadius: "20px",
            padding: "5px 15px",
          }}
        >
          <Button
            variant="contained"
            style={{
              backgroundColor: paused ? Colors.blue500 : Colors.red500,
              color: Colors.white,
              textTransform: "none",
            }}
            onClick={togglePlayPause}
          >
            {paused ? "Play" : "Pause"}
          </Button>
        </div>
      </div>
    );
  }
}

export default VideoPlayer;