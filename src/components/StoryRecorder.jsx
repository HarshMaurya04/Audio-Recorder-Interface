import { useState, useEffect, useRef, useCallback } from "react";
import {
  Button,
  IconButton,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Select,
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  InputAdornment,
} from "@mui/material";

import MicIcon from "@mui/icons-material/Mic";
import SettingsIcon from "@mui/icons-material/Settings";
import CloseIcon from "@mui/icons-material/Close";

import "./StoryRecorder.css";
import { checkAudioQuality } from "../utils/audioQualityChecker";

/* ============================================================
   HARDCODED STORY
   ============================================================ */

const STORY_TITLE = "The Little Forest Adventure";

const STORY_TEXT =
  "Once upon a time, there was a little girl who loved exploring the forest near her home. Every morning, she would walk along the quiet path and listen to the birds singing in the trees. One day, she discovered a beautiful hidden garden filled with colorful flowers.";

/* ============================================================
   RECORDER SETTINGS
   ============================================================ */

const defaultMimeType = "audio/webm";
const defaultBitrate = 64000;
const maxRecordingTime = 60;

/* ============================================================
   STORY RECORDER
   ============================================================ */

const StoryRecorder = () => {
  const formatTime = useCallback(
    (s) =>
      `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(
        2,
        "0",
      )}`,
    [],
  );

  /* ==========================================================
     RECORDER STATE
     ========================================================== */

  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [showText, setShowText] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [recorderSupported, setRecorderSupported] = useState(true);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const [micModalOpen, setMicModalOpen] = useState(false);

  const [inputDevices, setInputDevices] = useState([]);
  const [inputDevicesLoading, setInputDevicesLoading] = useState(false);

  const [selectedDeviceId, setSelectedDeviceId] = useState(null);

  const [audioBlob, setAudioBlob] = useState(null);
  const [audioURL, setAudioURL] = useState(null);

  const [submitted, setSubmitted] = useState(false);

  /* ==========================================================
     REFS
     ========================================================== */

  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);

  const isMountedRef = useRef(true);
  const animationRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const dataArrayRef = useRef(null);

  /* ==========================================================
     CLEANUP RECORDING
     ========================================================== */

  const cleanupRecording = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());

      streamRef.current = null;
    }

    if (audioContextRef.current) {
      if (audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }

      audioContextRef.current = null;
    }

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }

      mediaRecorderRef.current = null;
    }

    setTimer(0);
  };

  /* ==========================================================
     LOAD MICROPHONE DEVICES
     ========================================================== */

  const loadInputDevices = useCallback(async () => {
    setInputDevicesLoading(true);

    const devices = await navigator.mediaDevices.enumerateDevices();

    const audioInputs = devices.filter((d) => d.kind === "audioinput");

    const filtered = audioInputs.filter((device) => {
      const label = device.label?.trim();

      if (!label) return false;

      const ll = label.toLowerCase();

      return !(
        ll.includes("virtual") ||
        ll.includes("stereo mix") ||
        ll.includes("default") ||
        ll.includes("communications device") ||
        ll.includes("communications")
      );
    });

    const uniqueDevices = [];

    filtered.forEach((d) => {
      if (!uniqueDevices.some((u) => u.label === d.label)) {
        uniqueDevices.push(d);
      }
    });

    uniqueDevices.sort((a, b) => a.label.localeCompare(b.label));

    setInputDevices(uniqueDevices);
    setInputDevicesLoading(false);

    const savedId = localStorage.getItem("selectedMicDeviceId");

    const found = uniqueDevices.find((d) => d.deviceId === savedId);

    if (savedId && found) {
      setSelectedDeviceId((p) => (p !== savedId ? savedId : p));
    } else if (savedId && !found) {
      localStorage.removeItem("selectedMicDeviceId");

      alert(
        "Previously selected microphone is no longer available. Switching to the default microphone.",
      );

      const fb = uniqueDevices[0]?.deviceId;

      if (fb) {
        setSelectedDeviceId(fb);
      }
    } else if (!savedId && uniqueDevices.length > 0) {
      setSelectedDeviceId((p) => {
        const still = uniqueDevices.some((d) => d.deviceId === p);

        if (!still) {
          if (p !== null) {
            alert(
              "Selected microphone is no longer available. Switching to a default microphone.",
            );
          }

          return uniqueDevices[0]?.deviceId || null;
        }

        return p;
      });
    }

    return uniqueDevices.length > 0;
  }, []);

  /* ==========================================================
     CHECK RECORDER SUPPORT + MICROPHONE PERMISSION
     ========================================================== */

  const checkSupportAndPermission = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecorderSupported(false);
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setRecorderSupported(false);
      return;
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      s.getTracks().forEach((t) => t.stop());

      const has = await loadInputDevices();

      setPermissionGranted(has);
    } catch {
      setPermissionGranted(false);
    }
  }, [loadInputDevices]);

  useEffect(() => {
    checkSupportAndPermission();

    return () => cleanupRecording();
  }, [checkSupportAndPermission]);

  /* ==========================================================
     REQUEST MICROPHONE PERMISSION
     ========================================================== */

  const requestMicPermission = useCallback(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(async (stream) => {
        stream.getTracks().forEach((t) => t.stop());

        const has = await loadInputDevices();

        setPermissionGranted(has);
      })
      .catch((e) => {
        setPermissionGranted(false);

        if (e.name === "NotAllowedError" || e.name === "SecurityError") {
          alert(
            "Microphone access was denied. Please allow microphone permission in your browser settings.",
          );
        } else {
          alert("An error occurred while requesting microphone access.");
        }
      });
  }, [loadInputDevices]);

  /* ==========================================================
     DRAW WAVEFORM
     ========================================================== */

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    if (!canvas || !ctx || !analyser || !dataArray) {
      return;
    }

    const bufferLength = analyser.fftSize;

    const draw = () => {
      if (!analyserRef.current || !dataArrayRef.current || !canvasRef.current) {
        return;
      }

      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = "#f9f9f9";

      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0077cc";

      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;

      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;

        const y = (v * canvas.height) / 2;

        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);

      ctx.stroke();
    };

    draw();
  };

  /* ==========================================================
     START RECORDING
     ========================================================== */

  const startRecording = async () => {
    if (!permissionGranted) {
      setMicModalOpen(true);
      return;
    }

    if (isRecording || initializing) {
      return;
    }

    setAudioBlob(null);
    setAudioURL(null);

    setInitializing(true);
    setShowText(true);
    setTimer(0);

    try {
      const options = {
        mimeType: defaultMimeType,
        audioBitsPerSecond: defaultBitrate,
      };

      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        alert(`MIME type not supported: ${options.mimeType}`);

        stopRecording();

        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId
            ? {
                exact: selectedDeviceId,
              }
            : undefined,
        },
      });

      setIsRecording(true);

      streamRef.current = stream;

      audioChunksRef.current = [];

      audioContextRef.current = new (
        window.AudioContext || window.webkitAudioContext
      )();

      const source = audioContextRef.current.createMediaStreamSource(stream);

      analyserRef.current = audioContextRef.current.createAnalyser();

      analyserRef.current.fftSize = 1024;

      dataArrayRef.current = new Uint8Array(analyserRef.current.fftSize);

      source.connect(analyserRef.current);

      drawWaveform();

      const mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, {
          type: options.mimeType,
        });

        audioChunksRef.current = [];

        cleanupRecording();

        try {
          console.log("Checking audio quality...");

          const result = await checkAudioQuality(blob);

          console.log("Audio quality response:", result);

          alert(result.message);

          setAudioBlob(blob);
          setAudioURL(URL.createObjectURL(blob));
        } catch (error) {
          console.error("Audio quality check failed:", error);

          alert(error.message || "Unable to check audio quality.");
        } finally {
          if (isMountedRef.current) {
            setStopping(false);
          }
        }
      };

      mediaRecorder.start();
    } catch (err) {
      console.error("Recording error:", err);

      alert("Microphone access failed.");

      setIsRecording(false);

      cleanupRecording();
    } finally {
      setInitializing(false);
    }
  };

  /* ==========================================================
     STOP RECORDING
     ========================================================== */

  const stopRecording = useCallback(() => {
    try {
      if (mediaRecorderRef.current && isRecording) {
        setStopping(true);
        setIsRecording(false);

        setShowText(false);
        mediaRecorderRef.current?.stop();
      }
    } catch (e) {
      console.error("Failed to stop recorder:", e);

      alert("An error occurred while stopping the recording.");
    }
  }, [isRecording]);

  /* ==========================================================
     CLOSE MICROPHONE DIALOG
     ========================================================== */

  const closeMicModal = () => setMicModalOpen(false);

  /* ==========================================================
     MICROPHONE DEVICE CHANGE
     ========================================================== */

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }

    const handler = async () => await loadInputDevices();

    navigator.mediaDevices.addEventListener("devicechange", handler);

    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, [loadInputDevices]);

  /* ==========================================================
     RECORDING TIMER
     ========================================================== */

  useEffect(() => {
    if (!isRecording) return;

    const id = setInterval(() => {
      setTimer((p) => {
        const n = p + 1;

        if (n > maxRecordingTime) {
          stopRecording();

          return p;
        }

        return n;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [isRecording, stopRecording]);

  /* ==========================================================
     STOP WHEN PAGE BECOMES HIDDEN
     ========================================================== */

  useEffect(() => {
    if (!isRecording) return;

    const onVis = () => {
      if (document.hidden) {
        stopRecording();
      }
    };

    document.addEventListener("visibilitychange", onVis);

    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isRecording, stopRecording]);

  /* ==========================================================
     SHOW STORY AGAIN AFTER RETRY
     ========================================================== */

  useEffect(() => {
    if (!audioBlob) {
      setShowText(true);
    }
  }, [audioBlob]);

  /* ==========================================================
     RETRY
     ========================================================== */

  const handleRetry = () => {
    if (audioURL) {
      URL.revokeObjectURL(audioURL);
    }

    setAudioBlob(null);
    setAudioURL(null);
    setTimer(0);
    setSubmitted(false);
    setShowText(true);
  };

  /* ==========================================================
     SUBMIT ATTEMPT
     
     IMPORTANT:
     No backend upload.
     No API call.
     Just show confirmation.
     ========================================================== */

  const handleFinalSubmit = () => {
    if (!audioBlob) {
      alert("No audio recorded");
      return;
    }

    setSubmitted(true);
  };

  /* ==========================================================
     MICROPHONE DIALOG
     ========================================================== */

  const DesktopMicContent = (
    <>
      {!recorderSupported ? (
        <Alert severity="error">
          Your browser does not support audio recording.
        </Alert>
      ) : !permissionGranted ? (
        <>
          <Alert
            severity="error"
            style={{
              marginBottom: "1rem",
            }}
          >
            Please grant microphone access to use this feature.
          </Alert>

          <Button
            variant="contained"
            color="primary"
            onClick={requestMicPermission}
          >
            Enable Microphone
          </Button>
        </>
      ) : inputDevicesLoading ? (
        <Alert severity="info">Detecting microphones...</Alert>
      ) : inputDevices.length === 0 ? (
        <>
          <Alert
            severity="warning"
            style={{
              marginBottom: "1rem",
            }}
          >
            No microphone found. Please connect one and try again.
          </Alert>

          <Button
            variant="contained"
            color="warning"
            size="small"
            onClick={loadInputDevices}
          >
            Retry
          </Button>
        </>
      ) : (
        <FormControl fullWidth size="small">
          <InputLabel id="mic-selector-label">Select Microphone</InputLabel>

          <Select
            labelId="mic-selector-label"
            id="mic-selector"
            value={selectedDeviceId || ""}
            onChange={(e) => {
              const id = e.target.value;

              if (isRecording) {
                stopRecording();
              }

              setSelectedDeviceId(id);

              localStorage.setItem("selectedMicDeviceId", id);
            }}
            label="Select Microphone"
            input={
              <OutlinedInput
                label="Select Microphone"
                startAdornment={
                  <InputAdornment position="start">
                    <MicIcon fontSize="small" />
                  </InputAdornment>
                }
              />
            }
          >
            {inputDevices.map((d) => (
              <MenuItem key={d.deviceId} value={d.deviceId}>
                {d.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </>
  );

  const DesktopMicModal = (
    <Dialog
      open={micModalOpen}
      onClose={closeMicModal}
      aria-labelledby="mic-dialog-title"
      role="dialog"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle id="mic-dialog-title">
        <b>Microphone Settings</b>

        <IconButton
          aria-label="Close Dialog"
          title="Close Dialog"
          onClick={closeMicModal}
          sx={{
            position: "absolute",
            right: 8,
            top: 8,
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>{DesktopMicContent}</DialogContent>

      <DialogActions>
        <Button variant="contained" onClick={closeMicModal} autoFocus>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );

  /* ==========================================================
     CONFIRMATION SCREEN
     ========================================================== */

  if (submitted) {
    return (
      <div className="recorder-page">
        <div className="confirmation-card">
          <div className="success-icon">✓</div>

          <h2>Recording received</h2>

          <p>You have completed</p>

          <strong>{STORY_TITLE}</strong>

          <Button
            variant="contained"
            onClick={handleRetry}
            sx={{
              marginTop: 3,
              backgroundColor: "#4caf50",
              borderRadius: "30px",
              textTransform: "none",
              fontWeight: 600,
              padding: "10px 25px",
              "&:hover": {
                backgroundColor: "#43a047",
              },
            }}
          >
            Record Again
          </Button>
        </div>
      </div>
    );
  }

  /* ==========================================================
     MAIN RECORDER SCREEN
     ========================================================== */

  return (
    <div className="recorder-page">
      {DesktopMicModal}

      <div className="recorder-card">
        {/* HEADER */}

        <div className="recorder-header">
          <div className="recorder-title">{STORY_TITLE}</div>

          <IconButton
            aria-label="Open microphone settings"
            size="small"
            color="info"
            onClick={() => setMicModalOpen(true)}
            title="Microphone Settings"
          >
            <SettingsIcon />
          </IconButton>
        </div>

        {/* STORY */}

        <div className="story-box">{showText && <p>{STORY_TEXT}</p>}</div>

        {/* RECORDER CONTROLS */}

        <div className="recorder-controls">
          {/* TIMER */}

          <span
            className="recorder-timer"
            aria-live="polite"
            aria-atomic="true"
          >
            {formatTime(timer)}
          </span>

          {/* WAVEFORM */}

          <canvas
            ref={canvasRef}
            width={200}
            height={40}
            className="waveform-canvas"
            aria-hidden="true"
          />

          {/* START / STOP / RETRY */}

          {!isRecording && !audioBlob && (
            <Button
              variant="contained"
              onClick={startRecording}
              disabled={initializing || stopping}
              sx={{
                backgroundColor: "#007bff",
                borderRadius: "30px",
                textTransform: "none",
                fontWeight: "600",
                color: "#fff",
                boxShadow: "0 4px 10px rgba(0,119,255,0.3)",
                transition: "all 0.2s ease-in-out",
                "&:hover": {
                  backgroundColor: "#0066dd",
                  transform: "scale(1.03)",
                },
              }}
            >
              {initializing ? (
                <CircularProgress
                  size={20}
                  sx={{
                    color: "#fff",
                  }}
                />
              ) : (
                "Start"
              )}
            </Button>
          )}

          {isRecording && (
            <Button
              variant="contained"
              onClick={stopRecording}
              disabled={stopping}
              sx={{
                backgroundColor: "#ef5350",
                borderRadius: "30px",
                textTransform: "none",
                fontWeight: "600",
                color: "#fff",
                boxShadow: "0 4px 10px rgba(239,83,80,0.3)",
                "&:hover": {
                  backgroundColor: "#d32f2f",
                },
              }}
            >
              {stopping ? "Stopping..." : "Stop"}
            </Button>
          )}

          {audioBlob && !isRecording && (
            <>
              <Button
                variant="contained"
                onClick={handleRetry}
                sx={{
                  backgroundColor: "#ff9800",
                  borderRadius: "30px",
                  textTransform: "none",
                  fontWeight: "600",
                  color: "#fff",
                  "&:hover": {
                    backgroundColor: "#f57c00",
                  },
                }}
              >
                Retry
              </Button>

              <Button
                variant="contained"
                onClick={handleFinalSubmit}
                sx={{
                  backgroundColor: "#4caf50",
                  borderRadius: "30px",
                  textTransform: "none",
                  fontWeight: "600",
                  color: "#fff",
                  boxShadow: "0 4px 12px rgba(76,175,80,0.3)",
                  "&:hover": {
                    backgroundColor: "#43a047",
                  },
                }}
              >
                Submit Attempt
              </Button>
            </>
          )}
        </div>

        {/* RECORDED AUDIO PREVIEW */}

        {audioURL && !isRecording && (
          <div className="audio-preview">
            <audio controls src={audioURL} />
          </div>
        )}
      </div>
    </div>
  );
};

export default StoryRecorder;
