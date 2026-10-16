import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { MockMeroProvider } from '../test-utils/MockMeroProvider';
import { primeInvitationCapture, resetInvitationCaptureForTests } from './capture';
import { InvitationGate } from './InvitationGate';
import type { ParsedInvitation } from './useInviteRedemption';

interface Args {
  state: 'checking' | 'invited' | 'invalid';
  teamName: string;
  noun: string;
  appName: string;
}

/** Opens the story as an invite link would, before the gate first renders. */
function Harness({ state, teamName, noun, appName }: Args) {
  useState(() => {
    resetInvitationCaptureForTests();
    window.history.replaceState(null, '', `?invitation=${state === 'invalid' ? 'BAD' : 'story'}`);
    primeInvitationCapture('storybook');
    return null;
  });
  const parse = (token: string): ParsedInvitation | null =>
    token === 'BAD'
      ? null
      : { namespaceId: 'story-ns', invitation: {}, teamName: teamName || undefined };

  return (
    <MockMeroProvider isLoading={state === 'checking'}>
      <InvitationGate parse={parse} noun={noun} appName={appName}>
        <p>The app's landing page (hidden while the invitation waits on a login).</p>
      </InvitationGate>
    </MockMeroProvider>
  );
}

const meta: Meta<Args> = {
  title: 'Invitations/InvitationGate',
  render: (args) => <Harness key={args.state} {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    state: 'invited',
    teamName: 'Design team',
    noun: 'team',
    appName: 'Mero Design',
  },
  argTypes: {
    state: { control: 'select', options: ['checking', 'invited', 'invalid'] },
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Invited: Story = {};
export const Unnamed: Story = { args: { teamName: '' } };
export const CheckingSession: Story = { args: { state: 'checking' } };
export const Unreadable: Story = { args: { state: 'invalid' } };
