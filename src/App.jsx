import { Routes, Route } from "react-router-dom";
import StoryRecorder from "./components/StoryRecorder";
import StudentReport from "./components/StudentReport";

function App() {
  return (
    <Routes>
      <Route path="/" element={<StoryRecorder />} />
      <Route path="/report" element={<StudentReport />} />
    </Routes>
  );
}

export default App;