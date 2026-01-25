import React from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { MeroProvider, AppMode } from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';

import HomePage from './pages/home';
import Authenticate from './pages/login/Authenticate';

export default function App() {
  return (
    <MeroProvider
      packageName="com.calimero.kvstore"
      registryUrl="https://apps.calimero.network"
      mode={AppMode.SingleContext}
    >
      <ToastProvider>
        <BrowserRouter basename="/">
          <Routes>
            <Route path="/" element={<Authenticate />} />
            <Route path="/home" element={<HomePage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </MeroProvider>
  );
}
