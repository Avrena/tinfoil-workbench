// Entry point for the manual live account check; see account-live-setup.mjs. The setup module is
// evaluated first, so its temporary profile and observers exist before desktop/main.mjs creates the app.
import './account-live-setup.mjs';
import '../desktop/main.mjs';
