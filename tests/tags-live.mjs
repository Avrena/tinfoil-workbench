// Entry point for the manual live check of tags and titles; see tags-live-setup.mjs. The setup module is evaluated
// first, so its temporary profile and observers exist before desktop/main.mjs creates the app.
import './tags-live-setup.mjs';
import '../desktop/main.mjs';
