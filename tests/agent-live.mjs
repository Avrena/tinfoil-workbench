// Entry point for the manual live check of the workspace agent; see agent-live-setup.mjs. The setup module is evaluated
// first, so its temporary profile and observers exist before desktop/main.mjs creates the app.
import './agent-live-setup.mjs';
import '../desktop/main.mjs';
