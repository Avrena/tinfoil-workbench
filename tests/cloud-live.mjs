// Entry point for the manual live cloud sync check; see cloud-live-setup.mjs. The setup module is evaluated first,
// so its temporary profile and observers exist before desktop/main.mjs creates the app.
import './cloud-live-setup.mjs';
import '../desktop/main.mjs';
