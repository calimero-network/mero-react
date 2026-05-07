import React from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { MeroProvider, AppMode } from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';

import HomePage from './pages/home';
import Authenticate from './pages/login/Authenticate';
import SelectContext from './pages/context/SelectContext';

export default function App() {
  return (
    <MeroProvider
      packageName="com.calimero.kv-store"
      registryUrl="https://apps.calimero.network"
      mode={AppMode.MultiContext}
    >
      <ToastProvider>
        <BrowserRouter basename="/">
          <Routes>
            <Route path="/" element={<Authenticate />} />
            <Route path="/select-context" element={<SelectContext />} />
            <Route path="/home" element={<HomePage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </MeroProvider>
  );
}
