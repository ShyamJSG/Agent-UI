import { getWalkthroughFixture } from "./fixtures/paginationWalkthrough";
import { LiveTaskApp } from "./LiveTaskApp";
import { TaskViewer } from "./components/TaskViewer";
import "./styles.css";

export function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("live") === "1") return <LiveTaskApp />;
  const fixture = params.get("fixture");
  return <TaskViewer task={getWalkthroughFixture(fixture)} />;
}
