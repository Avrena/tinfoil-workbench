# Tinfoil cloud chats and projects

Workbench can show the chats and projects that Tinfoil Chat keeps in the cloud for your account, and write changes made in Workbench back to them. This is the Windows app only for now.

## Using it

1. Sign in to Tinfoil Chat in **Account & connection**.
2. Under **Tinfoil cloud chats**, paste your chat key (it starts with `key_`) and choose **Connect**, or choose **Open key file** for the key file you downloaded from Tinfoil Chat. The key is in Tinfoil Chat under Settings → Cloud sync. Workbench checks it against your account's current key before keeping it.
3. Your cloud chats appear in the sidebar with a cloud icon, and cloud projects appear among the projects. A chat's messages are fetched when you open it.

What changes in your Tinfoil account:

- **Continuing** a cloud chat writes the new turn back after the reply finishes. **Renaming** it, editing a message or reply, or choosing another reply writes it back too.
- **Deleting** a cloud chat deletes it from your Tinfoil account, after a question that says so.
- **Moving** a cloud chat into another cloud project, or out of projects, moves it in Tinfoil too. A cloud chat cannot move into a local project.
- **A new conversation in a cloud project** becomes a cloud chat after its first reply. **Move to Tinfoil cloud** in the conversation menu does the same for any local conversation outside local projects.
- Conversations that exist only in Workbench stay local.

Cloud projects are read here and managed in Tinfoil Chat: Workbench does not rename or delete them. For a chat in a cloud project, Workbench adds the project's name, description, instructions and document text to the request, after the conversation's own instructions if it has any, as Tinfoil Chat does.

Workbench syncs after sign-in, every ten minutes while it is open, and on **Sync now**. It lists your 300 most recent cloud chats. **Remove chat key** forgets the key and removes cloud chats and projects from this PC; they stay in your account.

## How it works

Tinfoil keeps cloud chats encrypted with your chat key, a 32-byte key that Tinfoil Chat shows as `key_` followed by two base-36 characters per byte. Its *sync enclave* at `sync.tinfoil.sh` seals and opens them, so Tinfoil's servers store ciphertext only. Workbench reaches the enclave through the Tinfoil SDK's attested client, verified against the `tinfoilsh/confidential-sync` repository like the inference enclave, and sends the key only over that verified channel. Requests carry your Tinfoil sign-in (the website session's identity token), as Tinfoil Chat's own requests do. New chat IDs come from `api.tinfoil.sh`, which receives only that token.

The protocol follows Tinfoil Chat's open-source web client (`tinfoilsh/tinfoil-webapp`, read, not copied): `/v1/key/current`, `/v1/sync/list-status`, `/v1/sync/pull`, `/v1/sync/push` and `/v1/sync/delete`, JSON over POST with protocol version 2. Every stored row has a version, and a write must name the version it was made against.

- **Listing** fetches each changed chat once to read its title. Workbench keeps a listed chat as a title and date until it is opened, so hundreds of cloud chats do not weigh on the workspace.
- **Writing back** pulls the chat, applies Workbench's changes to that copy and pushes it against the version it pulled. Messages that did not change are kept exactly, including every field Workbench does not use (attachments, web search results, timelines). A message whose text was edited keeps its other fields but not its timeline, which would still show the old text. New turns are added as user and assistant messages. Only finished replies are written.
- **Conflicts**: if the chat changed in Tinfoil since Workbench last synced it, the cloud version replaces it in Workbench, and Workbench's version is kept as a local conversation named "… (Workbench copy)". The enclave never merges; neither does Workbench. A newer version that is only the enclave re-sealing an old row is not a conflict.
- **Edit clock**: each write carries Tinfoil's edit clock (a counter and this installation's writer ID), so Tinfoil Chat orders Workbench's writes like its own.
- **Deleted in Tinfoil**: a chat that disappears from the listing leaves Workbench, unless it has changes that were not written yet; then it is kept as a local copy.

Images in cloud chats are not downloaded: Workbench shows the text of a chat and of its document attachments, which it also sends as reference files when you continue the chat. When you continue a cloud chat in Workbench, the model therefore does not see images from earlier turns.

## What is stored

- The chat key, its key ID and the Tinfoil user it belongs to are kept in the encrypted workspace, like a saved API key. Snapshots, logs and exports never contain the key.
- Cloud chats and projects are kept in the encrypted workspace like local conversations. Exports and imports drop the cloud link, so an import is always a new local conversation.
- Cloud data belongs to the account whose key was added. If another account signs in, sync stops until that account signs in again or the key is removed.

## Checks

- `tests/cloud.test.mjs`: key parsing (both forms), grouping messages into turns, mapping chats and projects, write-back fidelity (unchanged chats unchanged, unknown fields kept, edits, new turns, renames, long chats), project context, validation.
- `tests/cloud-sync.test.mjs`: the sync engine against an in-memory enclave with the same version rules (key check, listing and loading, write-back, conflicts before and during a write, re-sealed rows, deletions on both sides, uploads, another account, a changed key, the 300-chat limit, removing the key), the client's wire format, and the key ID against a WebCrypto HKDF derivation.
- `tests/ui-cloud.py`: the Account section, sidebar markers, the loading state and the conversation menu in the production renderer, with synthetic state.
- `tests/cloud-live.mjs` is a manual check with a real account; see its header. It checks, without writing, that writing back ten real chats unchanged would keep their messages exactly, then takes a new test chat through upload, rename, a second turn and deletion. It logs statuses and counts only.
