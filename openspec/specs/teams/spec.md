# teams Specification

## Purpose
TBD - created by archiving change add-teams-rbac-cloud-sync. Update Purpose after archive.

## Requirements

### Requirement: Team and workspace CRUD

The system SHALL provide team (workspace) CRUD with `teams` (id, name, owner_device_id, created_at) and `team_members` (team_id, member_id, email, role: owner|member, permissions JSON, status: pending|active) tables, and the active workspace SHALL be persisted in settings so the Profiles UI can be filtered by workspace.

#### Scenario: Create a team
- **WHEN** an authenticated Pro user posts `POST /api/v1/teams` with `{name}`
- **THEN** a `teams` row is created with `owner_device_id` = this device
- **AND** an owner `team_members` row is created for this device with `status='active'`
- **AND** a team master key is generated, stored locally (secret store), and returned only to the owner

#### Scenario: List teams for the local device
- **WHEN** `GET /api/v1/teams` is called
- **THEN** all `teams` rows where this device is a member are returned with the local role and effective permissions

#### Scenario: Rename and delete a team
- **WHEN** the owner calls `POST /api/v1/teams/:id/update` or `POST /api/v1/teams/:id/delete`
- **THEN** only the owner may rename or delete the team; members get `NO_PERMISSION`

#### Scenario: Active workspace switch
- **WHEN** the user picks a workspace in the sidebar switcher
- **THEN** the choice is stored in settings (`activeWorkspace`) and survives app restarts
- **AND** the Profiles list is filtered to the profiles of the active workspace

### Requirement: RBAC matrix

The system SHALL enforce role-based permissions: owner = everything; member rights = permission flags `{can_run_profiles, can_add_profiles, can_remove_profiles, can_invite}`. Only the owner removes members. Moving an account out of a team goes only to the owner's personal space.

#### Scenario: Owner has all rights
- **WHEN** an owner performs any team operation
- **THEN** the action is allowed regardless of the permission flags

#### Scenario: Member runs profiles
- **WHEN** a member with `can_run_profiles=true` starts a team profile
- **THEN** the action is allowed
- **AND** the same action for a member with `can_run_profiles=false` returns `NO_PERMISSION`

#### Scenario: Owner-only member removal
- **WHEN** a member (even with `can_invite=true`) calls the remove-member endpoint
- **THEN** the request is rejected with `NO_PERMISSION`
- **AND** when the owner removes a member, the member's local copy of the team key is revoked on next sync

#### Scenario: Transfer to owner's personal space only
- **WHEN** a profile is moved out of a team workspace
- **THEN** it is imported into the OWNER's personal workspace only, never into another member's personal space
- **AND** the profile is deleted from the team after the transfer

### Requirement: Invitations via email and activation code

The system SHALL implement invitations as email + activation code with status transition `pending → active`.

#### Scenario: Owner invites a member
- **WHEN** the owner posts `POST /api/v1/teams/:id/invites` with `{email, permissions}`
- **THEN** a `team_members` row is created with `status='pending'`, `role='member'` and a single-use activation code is returned
- **AND** the activation code is shown once and never stored in plaintext

#### Scenario: Accepting an invite
- **WHEN** the invitee posts `POST /api/v1/invites/accept` with `{email, activation_code}`
- **THEN** the matching `pending` row becomes `active`, bound to the invitee's device
- **AND** the encrypted team key payload is decrypted with the activation code and stored locally

#### Scenario: Owner cancels a pending invite
- **WHEN** the owner cancels a pending invitation
- **THEN** the `team_members` row is deleted and its activation code stops working
- **AND** an already-accepted member cannot be cancelled (use removal instead)

#### Scenario: Duplicate invite for the same email
- **WHEN** an invite is created for an email that already has a pending or active membership
- **THEN** the request fails with `ALREADY_MEMBER`
