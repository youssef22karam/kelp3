import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// No StrictMode: its double-run of effects would dispose GPU resources (geometries, materials, the render pipeline)
// that the scene's memoised objects then keep using.
createRoot(document.getElementById("root")!).render(<App />);
