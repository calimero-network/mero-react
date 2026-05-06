import React from 'react';
import { Link } from 'react-router-dom';
import {
  ConnectButton,
  CalimeroLogo,
  useMero,
  type MeroTheme,
} from '@calimero-network/mero-react';

interface ThemeVariant {
  label: string;
  description: string;
  theme?: MeroTheme;
  logoOnly?: boolean;
  buttonLabel?: string;
}

const variants: ThemeVariant[] = [
  {
    label: 'Default',
    description: 'Calimero green — no theme prop',
  },
  {
    label: 'Pink',
    description: 'primary + primaryHover + primaryText',
    theme: {
      primary: '#ff4081',
      primaryHover: '#e91e63',
      primaryText: '#ffffff',
    },
  },
  {
    label: 'Blue',
    description: 'Material blue',
    theme: {
      primary: '#3b82f6',
      primaryHover: '#2563eb',
      primaryText: '#ffffff',
    },
  },
  {
    label: 'Purple',
    description: 'Royal purple',
    theme: {
      primary: '#8b5cf6',
      primaryHover: '#7c3aed',
      primaryText: '#ffffff',
    },
  },
  {
    label: 'Sunset',
    description: 'Warm orange',
    theme: {
      primary: '#fb923c',
      primaryHover: '#ea580c',
      primaryText: '#1a0a00',
    },
  },
  {
    label: 'Mono',
    description: 'High contrast on light surface',
    theme: {
      primary: '#e6edf3',
      primaryHover: '#cdd5dc',
      primaryText: '#0d1117',
    },
  },
  {
    label: 'Pill',
    description: 'Fully rounded — `radius: "999px"`',
    theme: { radius: '999px' },
  },
  {
    label: 'Square',
    description: 'No rounding — `radius: "0"`',
    theme: { radius: '0' },
  },
  {
    label: 'Logo only',
    description: '`logoOnly` — square 40×40 icon button',
    logoOnly: true,
  },
  {
    label: 'Custom label',
    description: '`label="Sign in with Calimero"`',
    buttonLabel: 'Sign in with Calimero',
  },
];

export default function Authenticate() {
  const { isAuthenticated } = useMero();

  // No auto-redirect: `/` is a permanent showcase. When the user is
  // authenticated we surface a "Go to app →" link in the hero so they can
  // jump to /home explicitly.

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at top, #1c2128 0%, #0d1117 60%, #050709 100%)',
        color: '#e6edf3',
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        padding: '4rem 1.5rem',
        boxSizing: 'border-box',
      }}
    >
      <main
        style={{
          maxWidth: 960,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '3.5rem',
        }}
      >
        {/* Hero */}
        <header
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.25rem',
            textAlign: 'center',
          }}
        >
          <CalimeroLogo size={64} color="#a5ff11" />
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(2rem, 5vw, 2.75rem)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            Connect to Calimero
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 520,
              fontSize: '1rem',
              lineHeight: 1.55,
              color: '#8b949e',
            }}
          >
            One <code style={codeStyle}>&lt;ConnectButton /&gt;</code> handles
            local + remote node selection, the auth redirect, the connected
            dropdown, and reconnecting state. Customise it with a partial{' '}
            <code style={codeStyle}>theme</code> — each card below is a single
            prop change.
          </p>
          <div
            style={{
              marginTop: '0.5rem',
              display: 'flex',
              gap: '1rem',
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            <ConnectButton />
            {isAuthenticated && (
              <Link to="/home" style={appLinkStyle}>
                Go to app →
              </Link>
            )}
          </div>
        </header>

        {/* Showcase grid */}
        <section style={{ width: '100%' }}>
          <h2
            style={{
              margin: '0 0 1.5rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#8b949e',
              textAlign: 'center',
            }}
          >
            Theme variants
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem',
            }}
          >
            {variants.map((v) => (
              <div
                key={v.label}
                style={{
                  background: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: 12,
                  padding: '1.5rem 1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.75rem',
                  transition: 'border-color 0.15s ease, transform 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#3d4651';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#30363d';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <ConnectButton
                  theme={v.theme}
                  logoOnly={v.logoOnly}
                  label={v.buttonLabel}
                />
                <div
                  style={{
                    marginTop: '0.5rem',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: '#e6edf3',
                    }}
                  >
                    {v.label}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: '#8b949e',
                      marginTop: '0.25rem',
                    }}
                  >
                    {v.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Footer links */}
        <footer
          style={{
            display: 'flex',
            gap: '0.5rem',
            color: '#8b949e',
            fontSize: '0.875rem',
          }}
        >
          <a href="https://docs.calimero.network" style={linkStyle}>
            Docs
          </a>
          <span>·</span>
          <a href="https://github.com/calimero-network" style={linkStyle}>
            GitHub
          </a>
          <span>·</span>
          <a href="https://calimero.network" style={linkStyle}>
            calimero.network
          </a>
        </footer>
      </main>
    </div>
  );
}

const codeStyle: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 4,
  padding: '0.1rem 0.4rem',
  fontSize: '0.85em',
  fontFamily:
    "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
  color: '#a5ff11',
};

const linkStyle: React.CSSProperties = {
  color: '#8b949e',
  textDecoration: 'none',
  borderBottom: '1px solid transparent',
  transition: 'color 0.15s ease, border-color 0.15s ease',
};

const appLinkStyle: React.CSSProperties = {
  color: '#a5ff11',
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: '0.95rem',
  padding: '0.5rem 1rem',
  borderRadius: 8,
  border: '1px solid rgba(165, 255, 17, 0.3)',
  transition: 'background-color 0.15s ease, border-color 0.15s ease',
};
