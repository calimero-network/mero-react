import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { LoginModal } from './LoginModal';
import { ConnectionType } from '../types';
import type { MeroTheme } from '../theme';

interface FlatArgs {
  primary?: string;
  primaryHover?: string;
  primaryText?: string;
  background?: string;
  backgroundSecondary?: string;
  border?: string;
  text?: string;
  textSecondary?: string;
  error?: string;
  overlay?: string;
  radius?: string;
  connectionType?: ConnectionType;
}

const colorArg = { control: 'color' as const };

function buildTheme(args: FlatArgs): MeroTheme | undefined {
  const t: Record<string, string> = {};
  (
    [
      'primary',
      'primaryHover',
      'primaryText',
      'background',
      'backgroundSecondary',
      'border',
      'text',
      'textSecondary',
      'error',
      'overlay',
      'radius',
    ] as const
  ).forEach((k) => {
    if (args[k]) t[k] = args[k] as string;
  });
  return Object.keys(t).length ? (t as MeroTheme) : undefined;
}

const meta: Meta<FlatArgs> = {
  title: 'Components/LoginModal',
  component: LoginModal as never,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Modal rendered via React Portal at `document.body`. Stories keep it open by default; close + reopen toggles the open prop, useful for testing the close button + backdrop click.',
      },
    },
  },
  argTypes: {
    primary: { ...colorArg, description: 'Theme: primary / accent CTA colour' },
    primaryHover: { ...colorArg, description: 'Theme: primary on hover' },
    primaryText: { ...colorArg, description: 'Theme: text on top of primary' },
    background: { ...colorArg, description: 'Theme: modal surface' },
    backgroundSecondary: { ...colorArg, description: 'Theme: input + chip surface' },
    border: { ...colorArg, description: 'Theme: border colour' },
    text: { ...colorArg, description: 'Theme: primary text' },
    textSecondary: { ...colorArg, description: 'Theme: muted text' },
    error: { ...colorArg, description: 'Theme: error / danger' },
    overlay: { ...colorArg, description: 'Theme: modal backdrop' },
    radius: {
      control: 'text',
      description: 'Theme: border radius (e.g. 8px, 999px)',
    },
    connectionType: {
      control: 'select',
      options: [
        ConnectionType.RemoteAndLocal,
        ConnectionType.Remote,
        ConnectionType.Local,
      ],
    },
  },
  render: (args) => {
    const [open, setOpen] = useState(true);
    return (
      <div style={{ minHeight: '90vh' }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            top: 12,
            right: 12,
            padding: '6px 10px',
            background: '#161b22',
            color: '#e6edf3',
            border: '1px solid #30363d',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Reopen
        </button>
        <LoginModal
          isOpen={open}
          onConnect={(url) => {
            console.info('[LoginModal] onConnect →', url);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          connectionType={args.connectionType ?? ConnectionType.RemoteAndLocal}
          theme={buildTheme(args)}
        />
      </div>
    );
  },
};
export default meta;

type Story = StoryObj<FlatArgs>;

export const Default: Story = {
  args: { connectionType: ConnectionType.RemoteAndLocal },
};

export const RemoteOnly: Story = {
  args: { connectionType: ConnectionType.Remote },
};

export const LocalOnly: Story = {
  args: { connectionType: ConnectionType.Local },
};

export const Discovery: Story = {
  args: { connectionType: ConnectionType.Remote },
  parameters: {
    docs: {
      description: {
        story:
          'This story renders the `Remote` connection type to show the discovery view directly. It probes the well-known merod HTTP/RPC ports (2528–2531, plus the swarm-range 2428/2429 for back-compat) and the last-used node URL at `/admin-api/health`: with one or more nodes up, each is offered as a radio choice alongside an always-present "enter URL manually" option; with nothing running it shows "No local node found" and falls through to the URL field. Use the toolbar "Rescan" link after starting a node. In `RemoteAndLocal` mode (see the Default story) this exact view appears after selecting "Remote", while "Local" keeps the default-node behaviour.',
      },
    },
  },
};

export const Pink: Story = {
  args: {
    connectionType: ConnectionType.RemoteAndLocal,
    primary: '#ff4081',
    primaryHover: '#e91e63',
    primaryText: '#ffffff',
  },
};

export const Blue: Story = {
  args: {
    connectionType: ConnectionType.RemoteAndLocal,
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    primaryText: '#ffffff',
  },
};

export const Pill: Story = {
  args: { connectionType: ConnectionType.RemoteAndLocal, radius: '999px' },
};

export const FullCustom: Story = {
  args: {
    connectionType: ConnectionType.RemoteAndLocal,
    primary: '#fbbf24',
    primaryHover: '#f59e0b',
    primaryText: '#1a0a00',
    background: '#1c1917',
    backgroundSecondary: '#292524',
    border: '#44403c',
    text: '#fafaf9',
    textSecondary: '#a8a29e',
    radius: '12px',
  },
  parameters: {
    docs: {
      description: {
        story: 'Every theme token overridden — warm amber with stone surfaces.',
      },
    },
  },
};
