import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { InvitationDialog } from './InvitationDialog';
import { clearNamespaceJustJoined, markNamespaceJustJoined } from './justJoined';
import type { InviteRedemption, InviteState } from './useInviteRedemption';

/** Every stage is a fixed redemption state; only `syncing` needs the flag set. */
const NS = 'story-namespace';
const noop = () => {};

function fixed(state: InviteState): InviteRedemption {
  return {
    state,
    token: 'story',
    parsed: null,
    accept: noop,
    decline: noop,
    retry: noop,
    dismiss: noop,
  };
}

interface Args {
  stage: InviteState['stage'] | 'syncing';
  teamName: string;
  noun: string;
  appName: string;
}

function Harness({ stage, teamName, noun, appName }: Args) {
  const syncing = stage === 'syncing';
  useEffect(() => {
    if (syncing) markNamespaceJustJoined(NS);
    else clearNamespaceJustJoined(NS);
  }, [syncing]);

  const name = teamName || undefined;
  const state: InviteState =
    stage === 'syncing' || stage === 'joined'
      ? { stage: 'joined', namespaceId: NS, teamName: name }
      : stage === 'already-member'
        ? { stage, namespaceId: NS, teamName: name }
        : stage === 'failed'
          ? {
              stage,
              message: 'HTTP 503',
              reason: 'no-one-online',
              retryable: true,
            }
          : stage === 'idle'
            ? { stage }
            : { stage, teamName: name };

  return <InvitationDialog redemption={fixed(state)} noun={noun} appName={appName} />;
}

const meta: Meta<Args> = {
  title: 'Invitations/InvitationDialog',
  render: (args) => <Harness {...args} />,
  args: {
    stage: 'awaiting-confirmation',
    teamName: 'Design team',
    noun: 'workspace',
    appName: 'Mero Docs',
  },
  argTypes: {
    stage: {
      control: 'select',
      options: [
        'awaiting-confirmation',
        'joining',
        'syncing',
        'joined',
        'already-member',
        'failed',
      ],
    },
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Ask: Story = {};
export const Joining: Story = { args: { stage: 'joining' } };
export const Syncing: Story = { args: { stage: 'syncing' } };
export const Ready: Story = { args: { stage: 'joined' } };
export const AlreadyMember: Story = { args: { stage: 'already-member' } };
export const Failed: Story = { args: { stage: 'failed' } };
