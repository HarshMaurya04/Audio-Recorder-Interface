import { useState, useEffect, useRef } from "react";
import {
  Typography,
  IconButton,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useMediaQuery,
  useTheme,
  CircularProgress,
  Alert,
} from "@mui/material";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { getReportPayload, closeWebView } from "../services/botExtension";

// ─── CONFIG ────────────────────────────────────────────────────
const API_ENDPOINT = `${import.meta.env.VITE_LAMBDA_API_ENDPOINT}/webhook`;

// ─── Helper: map raw Lambda JSON → component report shape ───────
function mapApiResponseToReport(data) {
  const reportCard = data?.reportCard ?? {};
  const paraResults = reportCard?.paraResults ?? [];
  const firstPara = paraResults[0] || {};

  const formatValue = (val) => {
    if (val === -1 || val === null || val === undefined) return "NA";
    return val;
  };

  let improper = 0;
  let missed = 0;

  paraResults.forEach((para) => {
    (para.wordFeedback || []).forEach((w) => {
      if (w.pbLabel === "i") improper++;
      if (w.pbLabel === "d") missed++;
    });
  });

  return {
    audioUrl: data?.audioUrl ?? null,
    storyTitle: data?.storyTitle ?? "Reading Assessment",

    overallScore: formatValue(reportCard?.overallScore),
    wcpm: formatValue(reportCard?.wcpm),
    accuracyScore: formatValue(reportCard?.accuracyScore),

    readingAccuracy:
      reportCard?.readingAccuracy === -1 || reportCard?.readingAccuracy == null
        ? "NA"
        : Math.round(reportCard.readingAccuracy * 100),

    paceScore: formatValue(reportCard?.paceScore),

    pace: firstPara?.status === 2 ? "Slow" : (firstPara?.pace ?? "-"),

    speechRate:
      firstPara?.status === 2 ? "NA" : (reportCard?.speechRate ?? "NA"),

    phrasingScore: formatValue(reportCard?.phrasingScore),
    improperPhraseBreaks: formatValue(improper),
    missedPhraseBreaks: formatValue(missed),
    prominenceScore: formatValue(reportCard?.prominenceScore),
    paraResults: paraResults.map((para) => ({
      wordFeedback: (para.wordFeedback ?? []).map((w) => ({
        promptWord: w.promptWord ?? "",
        decodedWord: w.decodedWord ?? "",
        miscueLabel: w.miscueLabel ?? "c",
        pbLabel: w.pbLabel ?? null,
      })),

      ctm: para.ctm ?? [],
    })),
  };
}

// ─── Score Badge ────────────────────────────────────────────────
function ScoreBadge({ label, value, compact = false }) {
  return (
    <div
      style={{
        backgroundColor: "#0288d1",
        color: "white",
        borderRadius: "8px",
        padding: compact ? "5px 8px" : "8px 12px",
        fontSize: compact ? "12px" : "14px",
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
      }}
    >
      {label}: {value === -1 ? "NA" : value}
    </div>
  );
}

// Displays scores in compact 2-column grid for mobile UI
function MobileScoreGrid({ r }) {
  const scores = [
    { label: "Overall Score", value: r.overallScore },
    { label: "WCPM", value: r.wcpm },
    { label: "Accuracy Score", value: r.accuracyScore },
    {
      label: "Reading Accuracy",
      value: r.readingAccuracy === "NA" ? "NA" : `${r.readingAccuracy}%`,
    },
    { label: "Pace Score (P)", value: r.paceScore },
    {
      label: "Pace",
      value:
        r.speechRate === "NA" ? r.pace : `${r.pace} (${r.speechRate} syl/s)`,
    },
    { label: "Phrasing (Ph)", value: r.phrasingScore },
    { label: "Improper Breaks", value: r.improperPhraseBreaks },
    { label: "Missed Breaks", value: r.missedPhraseBreaks },
    { label: "Prominence (P)", value: r.prominenceScore },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "6px",
      }}
    >
      {scores.map(({ label, value }) => (
        <ScoreBadge key={label} label={label} value={value} compact />
      ))}
    </div>
  );
}

// Converts wordFeedback + CTM (timings) → renderable words
// Maps each word with text, timing (start/end), and miscue type
// Used for highlighting words during audio playback
function generateRenderableData(wordFeedback, ctm = []) {
  let ctmIndex = 0;

  return wordFeedback.map((item, index) => {
    let displayText = "";

    switch (item.miscueLabel) {
      case "s":
      case "d":
      case "c":
        displayText = item.promptWord;
        break;
      case "i":
      default:
        displayText = item.decodedWord || item.promptWord;
        break;
    }

    let startTime = null;
    let endTime = null;

    if (item.miscueLabel !== "d") {
      const spokenWordCount =
        item.miscueLabel === "d"
          ? 0
          : item.decodedWord && item.decodedWord.trim().length > 0
            ? item.decodedWord
                .trim()
                .split(/[\s_]+/)
                .filter(Boolean).length
            : 1;

      if (ctmIndex < ctm.length) {
        startTime = parseFloat(ctm[ctmIndex].s);

        const endCtxIndex = Math.min(
          ctmIndex + spokenWordCount - 1,
          ctm.length - 1,
        );

        endTime = parseFloat(ctm[endCtxIndex].e);
      }

      ctmIndex += spokenWordCount;
    }

    return {
      id: `word-${index}`,
      text: displayText,
      miscueType: item.miscueLabel,
      startTime,
      endTime,
      pbLabel: item.pbLabel,
    };
  });
}

// Finds which word should be highlighted based on current audio time
// Uses small buffer (-0.07) to improve sync accuracy
function getActiveWordIndex(words, currentTime) {
  let activeIdx = -1;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word.startTime == null || word.endTime == null) continue;

    if (currentTime >= word.startTime - 0.07 && currentTime <= word.endTime) {
      activeIdx = i;
    }
  }

  return activeIdx;
}

// Renders each word with styling based on reading mistakes:
// correct (green), substitution (purple), deletion (strike), insertion (underline)
// Also highlights active word during playback
function WordToken({ word, isHighlighted, isMobile }) {
  const fontSize = isMobile ? "14px" : "16px";

  if (!word.text || word.text.trim() === "") return null;

  let style = {
    fontSize,
    backgroundColor: isHighlighted ? "#91eaef" : "transparent",
    color: "black",
  };

  switch (word.miscueType) {
    case "c":
      style.color = "green";
      break;

    case "s":
      style.color = "purple";
      break;

    case "d":
      style.textDecoration = "line-through";
      break;

    case "i":
      style.textDecoration = "underline";
      break;
  }

  const pbColorMap = {
    c: "#1a8a1a",
    i: "red",
    d: "purple",
  };

  return (
    <>
      <Typography component="span" style={style}>
        {word.text}
      </Typography>

      <span> </span>

      {word.pbLabel && (
        <Typography
          component="span"
          style={{ fontSize, color: pbColorMap[word.pbLabel] }}
        >
          ||{" "}
        </Typography>
      )}
    </>
  );
}

// ─── Legend Row ──────────────────────────────────────────────────
function LegendRow({ label, extraStyle = {} }) {
  return (
    <Typography
      style={{
        borderBottom: "1px solid #e0e0e0",
        padding: "6px 8px",
        textAlign: "center",
        fontSize: "13px",
        ...extraStyle,
      }}
    >
      {label}
    </Typography>
  );
}

// ─── Mobile Legend ───────────────────────────────────────────────
function MobileLegend() {
  const items = [
    { label: "Correct", extraStyle: { color: "green" } },
    { label: "Substitution", extraStyle: { color: "purple" } },
    {
      label: "Deletion",
      extraStyle: { textDecoration: "line-through" },
    },
    {
      label: "Insertion",
      extraStyle: { textDecoration: "underline" },
    },
    { label: "|| Correct", extraStyle: { color: "green" } },
    { label: "|| Improper", extraStyle: { color: "red" } },
    { label: "|| Missed", extraStyle: { color: "purple" } },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        marginTop: "8px",
      }}
    >
      {items.map(({ label, extraStyle }) => (
        <div
          key={label}
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "20px",
            padding: "3px 10px",
            fontSize: "12px",
            backgroundColor: "#fafafa",
            ...extraStyle,
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

// ─── Loading State ───────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        backgroundColor: "#e8eaf0",
      }}
    >
      <CircularProgress style={{ color: "#0288d1" }} />
      <Typography style={{ color: "#555", fontSize: 15 }}>
        Loading your report…
      </Typography>
    </div>
  );
}

// ─── Error State ─────────────────────────────────────────────────
function ErrorScreen({ message }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        backgroundColor: "#e8eaf0",
      }}
    >
      <Alert severity="error" style={{ maxWidth: 500 }}>
        {message}
      </Alert>
    </div>
  );
}

// Main component:
// - Fetches report data from Lambda using fileId
// - Stores sender for WebView close handling
// - Manages audio playback + word highlighting
// - Handles loading, error, and UI rendering (mobile + desktop)
export default function StudentReport() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [sender, setSender] = useState(null);
  const audioRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const prev = {
      body: document.body.style.overflow,
      html: document.documentElement.style.overflow,
    };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev.body;
      document.documentElement.style.overflow = prev.html;
    };
  }, []);

  // ── Fetch report from Lambda ──────────────────────────────────
  useEffect(() => {
    async function fetchReport() {
      try {
        const payload = await getReportPayload();

        if (!payload || !payload.fileId) {
          throw new Error("Missing payload from SwiftChat");
        }

        setSender(payload.sender);

        const { fileId, storyTitle } = payload;

        const res = await fetch(
          `${API_ENDPOINT}?fileId=${encodeURIComponent(fileId)}`,
        );

        if (!res.ok) {
          throw new Error(`Failed to fetch report (status ${res.status})`);
        }

        const data = await res.json();

        const mapped = mapApiResponseToReport(data);
        mapped.storyTitle = storyTitle;

        setReport(mapped);
      } catch (err) {
        console.error("Report fetch error:", err);
        setError(
          "Could not load your report. Please try again or contact support.",
        );
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, []);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;
  if (!report) return <ErrorScreen message="No report data available." />;

  const r = report;

  const isBlank =
    !r.paraResults?.length || r.paraResults[0]?.wordFeedback?.length === 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#e8eaf0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? "8px" : "24px",
      }}
    >
      <Paper
        elevation={3}
        style={{
          width: "100%",
          maxWidth: 1100,
          height: "100%",
          borderRadius: isMobile ? "12px" : "16px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "white",
        }}
      >
        {/* Back button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            padding: isMobile ? "16px 12px 8px" : "20px 20px 12px",
          }}
        >
          <IconButton
            style={{
              padding: 0,
              color: "#0288d1",
            }}
            onClick={() => closeWebView(sender)}
          >
            <ArrowBackIosNewIcon style={{ fontSize: isMobile ? 22 : 26 }} />
          </IconButton>
        </div>

        {/* ── Scrollable inner ── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isMobile ? "8px 12px 16px" : "12px 20px 20px",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {/* ══ MOBILE LAYOUT ════════════════════════════════════ */}
          {isMobile ? (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <Typography style={{ fontWeight: 700, fontSize: 16 }}>
                Story Read: {r.storyTitle}
              </Typography>

              {/* Scores accordion */}
              <Accordion
                disableGutters
                elevation={0}
                defaultExpanded
                sx={{
                  backgroundColor: "#f1f3f9",
                  borderRadius: "12px !important",
                  "&:before": { display: "none" },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  sx={{ minHeight: 44, px: 1.5 }}
                >
                  <Typography style={{ fontWeight: 600, fontSize: 14 }}>
                    📊 Scores Overview
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, px: 1.5, pb: 1.5 }}>
                  <MobileScoreGrid r={r} />
                </AccordionDetails>
              </Accordion>

              {/* Legend accordion */}
              <Accordion
                disableGutters
                elevation={0}
                sx={{
                  backgroundColor: "#f1f3f9",
                  borderRadius: "12px !important",
                  "&:before": { display: "none" },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  sx={{ minHeight: 44, px: 1.5 }}
                >
                  <Typography style={{ fontWeight: 600, fontSize: 14 }}>
                    <InfoOutlinedIcon
                      style={{
                        fontSize: 16,
                        marginRight: "4px",
                        verticalAlign: "middle",
                      }}
                    />
                    Word Legend
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, px: 1.5, pb: 1.5 }}>
                  <MobileLegend />
                </AccordionDetails>
              </Accordion>

              {/* Paragraph cards */}
              {isBlank && (
                <Alert severity="info" style={{ marginBottom: "12px" }}>
                  No speech detected. Please try recording again.
                </Alert>
              )}

              {/* Paragraph cards */}
              {!isBlank &&
                r.paraResults.map((para, index) => (
                  <Paper
                    key={para.paraNo}
                    elevation={0}
                    style={{
                      backgroundColor: "#f1f3f9",
                      borderRadius: "12px",
                      padding: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "10px",
                      }}
                    >
                      <Typography
                        style={{
                          fontWeight: 700,
                          fontSize: 15,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Para {index + 1}
                      </Typography>
                      {!isBlank && (
                        <audio
                          ref={audioRef}
                          controls
                          src={r.audioUrl}
                          
                          // Sync audio playback with word highlighting using requestAnimationFrame
                          // Continuously updates currentTime for smooth highlighting
                          onPlay={() => {
                            const tick = () => {
                              if (audioRef.current) {
                                setCurrentTime(audioRef.current.currentTime);
                                rafRef.current = requestAnimationFrame(tick);
                              }
                            };
                            rafRef.current = requestAnimationFrame(tick);
                          }}
                          onPause={() => {
                            if (rafRef.current)
                              cancelAnimationFrame(rafRef.current);
                          }}
                          onEnded={() => {
                            if (rafRef.current)
                              cancelAnimationFrame(rafRef.current);
                            setCurrentTime(0);
                          }}
                          style={{
                            width: "100%",
                            height: "36px",
                            borderRadius: "12px",
                            border: "1px solid #000000",
                          }}
                        />
                      )}
                    </div>
                    <div style={{ lineHeight: 2.2 }}>
                      {(() => {
                        const renderableWords = generateRenderableData(
                          para.wordFeedback,
                          para.ctm,
                        );
                        const activeWordIndex = getActiveWordIndex(
                          renderableWords,
                          currentTime,
                        );

                        return renderableWords.map((word, i) => (
                          <WordToken
                            key={word.id}
                            word={word}
                            isHighlighted={i === activeWordIndex}
                            isMobile
                          />
                        ));
                      })()}
                    </div>
                  </Paper>
                ))}
            </div>
          ) : (
            /* ══ DESKTOP LAYOUT ══════════════════════════════════ */
            <div
              style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}
            >
              {/* Main column */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Paper
                  elevation={0}
                  style={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: "12px",
                    padding: "16px",
                    marginBottom: "12px",
                  }}
                >
                  <Typography
                    style={{
                      fontWeight: 700,
                      fontSize: 18,
                      marginBottom: "12px",
                    }}
                  >
                    Story Read: {r.storyTitle}
                  </Typography>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <ScoreBadge
                      label="Overall Score (A + P + Ph + Pr)"
                      value={r.overallScore}
                    />
                    <ScoreBadge label="WCPM" value={r.wcpm} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <ScoreBadge
                      label="Accuracy Score (A)"
                      value={r.accuracyScore}
                    />
                    <ScoreBadge
                      label="Reading Accuracy"
                      value={
                        r.readingAccuracy === "NA"
                          ? "NA"
                          : `${r.readingAccuracy}%`
                      }
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <ScoreBadge label="Pace Score (P)" value={r.paceScore} />
                    <ScoreBadge
                      label="Pace"
                      value={
                        r.speechRate === "NA"
                          ? r.pace
                          : `${r.pace} (${r.speechRate} syl/sec)`
                      }
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    <ScoreBadge
                      label="Phrasing Score (Ph)"
                      value={r.phrasingScore}
                    />
                    <ScoreBadge
                      label="Improper Phrase Breaks"
                      value={r.improperPhraseBreaks}
                    />
                    <ScoreBadge
                      label="Missed Phrase Breaks"
                      value={r.missedPhraseBreaks}
                    />
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
                  >
                    <ScoreBadge
                      label="Prominence Score (P)"
                      value={r.prominenceScore}
                    />
                  </div>
                </Paper>

                {/* No speech message */}
                {isBlank && (
                  <Alert severity="info" style={{ marginBottom: "12px" }}>
                    No speech detected. Please try recording again.
                  </Alert>
                )}

                {/* Paragraph cards */}
                {!isBlank &&
                  r.paraResults.map((para, index) => (
                    <Paper
                      key={para.paraNo}
                      elevation={0}
                      style={{
                        backgroundColor: "#f1f3f9",
                        borderRadius: "12px",
                        padding: "16px",
                        marginBottom: "12px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          marginBottom: "12px",
                        }}
                      >
                        <Typography
                          style={{
                            fontWeight: 700,
                            fontSize: 18,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Paragraph {index + 1}
                        </Typography>
                        {!isBlank && (
                          <audio
                            ref={audioRef}
                            controls
                            src={r.audioUrl}

                            // Sync audio playback with word highlighting using requestAnimationFrame
                            // Continuously updates currentTime for smooth highlighting
                            onPlay={() => {
                              const tick = () => {
                                if (audioRef.current) {
                                  setCurrentTime(audioRef.current.currentTime);
                                  rafRef.current = requestAnimationFrame(tick);
                                }
                              };
                              rafRef.current = requestAnimationFrame(tick);
                            }}
                            onPause={() => {
                              if (rafRef.current)
                                cancelAnimationFrame(rafRef.current);
                            }}
                            onEnded={() => {
                              if (rafRef.current)
                                cancelAnimationFrame(rafRef.current);
                              setCurrentTime(0);
                            }}
                            style={{
                              width: "100%",
                              height: "36px",
                              borderRadius: "12px",
                              border: "1px solid #000000",
                            }}
                          />
                        )}
                      </div>
                      <div style={{ lineHeight: 2 }}>
                        {(() => {
                          const renderableWords = generateRenderableData(
                            para.wordFeedback,
                            para.ctm,
                          );
                          const activeWordIndex = getActiveWordIndex(
                            renderableWords,
                            currentTime,
                          );

                          return renderableWords.map((word, i) => (
                            <WordToken
                              key={word.id}
                              word={word}
                              isHighlighted={i === activeWordIndex}
                            />
                          ));
                        })()}
                      </div>
                    </Paper>
                  ))}
              </div>

              {/* Sidebar */}
              <div
                style={{
                  width: "200px",
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <Paper
                  elevation={0}
                  style={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: "12px",
                    padding: "8px 12px",
                  }}
                >
                  <Typography style={{ fontWeight: 700 }}>
                    Attempt Summary :
                  </Typography>
                </Paper>
                <Paper
                  elevation={0}
                  style={{
                    backgroundColor: "#f1f3f9",
                    borderRadius: "12px",
                    padding: "12px",
                  }}
                >
                  <Typography
                    style={{
                      fontWeight: 700,
                      textAlign: "center",
                      marginBottom: "8px",
                    }}
                  >
                    Words Mistakes
                  </Typography>
                  <LegendRow label="Correct" extraStyle={{ color: "green" }} />
                  <LegendRow
                    label="Substitution"
                    extraStyle={{ color: "purple" }}
                  />
                  <LegendRow
                    label="Deletion"
                    extraStyle={{
                      textDecoration: "line-through",
                    }}
                  />
                  <LegendRow
                    label="Insertion"
                    extraStyle={{ textDecoration: "underline" }}
                  />
                  <Typography
                    style={{
                      fontWeight: 700,
                      textAlign: "center",
                      marginTop: "12px",
                      marginBottom: "8px",
                    }}
                  >
                    Phase Breaks ||
                  </Typography>
                  <LegendRow
                    label="|| - Correct"
                    extraStyle={{ color: "green" }}
                  />
                  <LegendRow
                    label="|| - Improper Breaks"
                    extraStyle={{ color: "red" }}
                  />
                  <LegendRow
                    label="|| - Missed Breaks"
                    extraStyle={{ color: "purple" }}
                  />
                </Paper>
              </div>
            </div>
          )}
        </div>
      </Paper>
    </div>
  );
}
