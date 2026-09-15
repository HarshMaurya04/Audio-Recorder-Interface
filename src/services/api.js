// ============================================================
// UPLOAD AUDIO TO BACKEND
// Converts audio blob → base64 → sends to Lambda for processing
// ============================================================
export const uploadAudioToBackend = async (audioBlob, sender, story) => {

  // Convert recorded audio blob into base64 string
  const base64 = await blobToBase64(audioBlob);

  // Send audio + metadata to backend (Lambda webhook)
  const response = await fetch(
    `${import.meta.env.VITE_LAMBDA_API_ENDPOINT}/webhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },

      // Payload contains audio + story context for evaluation
      body: JSON.stringify({
        source: "webview",
        sender: sender,
        audio: base64,
        reference_text_id: story.reference_text_id,
        para_no: story.para_no,
        language: story.lang,
      }),
    },
  );

  // Handle failed API response
  if (!response.ok) {
    throw new Error("Upload failed");
  }

  // Return backend response (usually success/ack)
  return response.json();
};


// ============================================================
// CONVERT BLOB → BASE64
// Required because API expects base64 encoded audio
// ============================================================
const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.readAsDataURL(blob); // read blob as base64
    
    reader.onloadend = () => {
      // Extract only base64 string (remove metadata prefix)
      resolve(reader.result.split(",")[1]);
    };
    reader.onerror = reject;  // handle read errors
  });
