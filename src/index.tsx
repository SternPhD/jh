import React from 'react';
import { render } from 'ink';
import { App } from './app.js';

const app = render(<App />);

// Clear the terminal when the app exits
app.waitUntilExit().then(() => {
  app.clear();
});
