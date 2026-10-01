// Entry point for the manual live check that the web keeps an unknown chat field; see cloud-field-live-setup.mjs. The
// setup module is evaluated first, so its temporary profile and observers exist before desktop/main.mjs creates the app.
import './cloud-field-live-setup.mjs';
import '../desktop/main.mjs';
