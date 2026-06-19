import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProfileListQuickPickItems,
  buildProfileSwitchQuickPickItems,
} from '../../src/utils/profile-quick-pick'

test('buildProfileListQuickPickItems formats profile labels and descriptions', () => {
  assert.deepEqual(
    buildProfileListQuickPickItems([
      {
        id: 'one',
        name: 'Work',
        email: 'work@example.com',
        planType: 'team',
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
      },
      {
        id: 'two',
        name: 'Personal',
        email: 'Unknown',
        planType: 'plus',
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
      },
    ]),
    [
      {
        label: 'Work',
        description: 'work@example.com',
        profileId: 'one',
      },
      {
        label: 'Personal',
        description: undefined,
        profileId: 'two',
      },
    ],
  )
})

test('buildProfileSwitchQuickPickItems formats active and inactive profiles', () => {
  const items = buildProfileSwitchQuickPickItems(
    [
      {
        id: 'one',
        name: 'Work',
        email: 'work@example.com',
        planType: 'team',
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
      },
      {
        id: 'two',
        name: 'Personal',
        email: 'Unknown',
        planType: 'plus',
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
      },
    ],
    'one',
    'Active',
    (profile) => `${profile.planType}:${profile.name}`,
  )

  assert.deepEqual(items, [
    {
      label: 'Work',
      description: 'team:Work',
      detail: 'work@example.com • Active',
      profileId: 'one',
    },
    {
      label: 'Personal',
      description: 'plus:Personal',
      detail: '',
      profileId: 'two',
    },
  ])
})
