// ============================================================
// FETCH STORY PAYLOAD FROM WEBVIEW
// This function retrieves the payload sent from the bot when
// opening the WebView (e.g., story data like grade, language, text).
// ============================================================
export const getStoryPayload = () => {
  return new Promise((resolve) => {

    // Check if WebView is opened inside bot environment
    if (!window.BotExtension) {
      resolve(null); // fallback if not inside bot
      return;
    }

    // Get payload from bot
    window.BotExtension.getPayload((data) => {
      try {
        // Parse JSON payload safely
        const parsed = JSON.parse(data?.value || "{}");
        resolve(parsed);
      } catch (err) {
        // Handle invalid JSON case
        console.error("Payload parse error:", err);
        resolve(null);
      }
    });
  });
};

// ============================================================
// FETCH REPORT PAYLOAD FROM WEBVIEW
// This is used when opening the detailed report page.
// Payload typically contains fileId, storyTitle, sender, etc.
// ============================================================
export const getReportPayload = () => {
  return new Promise((resolve) => {

    // Ensure bot environment is available
    if (window.BotExtension) {
      window.BotExtension.getPayload((data) => {
        try {
          // Safely parse payload JSON
          const parsed = JSON.parse(data?.value || "{}");
          resolve(parsed);
        } catch (e) {
          console.error("Payload parse error:", e);
          resolve(null);
        }
      });
    } else {
      // If opened outside bot (e.g., direct browser access)
      resolve(null);
    }
  });
};

// ============================================================
// CLOSE WEBVIEW HANDLER
// This function handles:
// 1. Sending exit event to backend (if user did NOT record audio)
// 2. Closing the WebView safely
// ============================================================
export const closeWebView = async (sender, hasRecorded = false) => {
  try {
    
    // Only notify backend if user exits WITHOUT recording
    // This helps track incomplete attempts / drop-offs
    if (!hasRecorded) {
      await fetch(`${import.meta.env.VITE_LAMBDA_API_ENDPOINT}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },

        // Send exit event data to backend
        body: JSON.stringify({
          source: "webview_exit",
          sender: sender,
          hasRecorded: false,
        }),
      });
    }
  } catch (err) {
    // Log API failure (non-blocking)
    console.error("Exit API error:", err);
  }

  // Close WebView using bot SDK
  if (window.BotExtension) {
    window.BotExtension.close();
  }
};
