# Tinfoil cloud chats and projects

Workbench can show the chats and projects that Tinfoil Chat keeps in the cloud for your account, and write changes made in Workbench back to them. This is the Windows app only for now.

## Using it

1. Sign in to Tinfoil Chat in **Account & connection**.
2. Under **Tinfoil cloud chats**, paste your chat key (it starts with `key_`) and choose **Connect**, or choose **Open key file** for the key file you downloaded from Tinfoil Chat. The key is in Tinfoil Chat under Settings → Cloud sync. Workbench checks it against your account's current key before keeping it.
3. Your cloud chats appear in the sidebar with a cloud icon, and cloud projects appear among the projects. A chat's messages are fetched when you open it.
4. While the chat key is connected, **Cloud** and **Local** under the Threads heading switch the list between cloud chats and local conversations, and the Threads heading has a **Sync** button. A new conversation started while the Cloud list shows becomes a cloud chat after its first reply. Hovering a thread offers **Delete** and, for a local conversation with messages outside projects, **Move to Tinfoil cloud**.

What changes in your Tinfoil account:

- **Continuing** a cloud chat writes the new turn back after the reply finishes, with its text files and pictures. **Renaming** it, editing a message or reply, or choosing another reply writes it back too.
- **Deleting** a cloud chat deletes it from your Tinfoil account, after a question that says so.
- **Moving** a cloud chat into another cloud project, or out of projects, moves it in Tinfoil too. A cloud chat cannot move into a local project.
- **A new conversation in a cloud project** becomes a cloud chat after its first reply. **Move to Tinfoil cloud** in the conversation menu does the same for any local conversation outside local projects.
- Conversations that exist only in Workbench stay local.

Cloud projects are read here and managed in Tinfoil Chat: Workbench does not rename or delete them. For a chat in a cloud project, Workbench adds the project's name, description, instructions and document text to the request, after the conversation's own instructions if it has any, as Tinfoil Chat does.

Workbench syncs after sign-in, every ten minutes while it is open, and on **Sync now** (in the account view) or the sidebar's **Sync** button. It lists your 300 most recent cloud chats. **Remove chat key** forgets the key and removes cloud chats and projects from this PC; they stay in your account.

## How it works

Tinfoil keeps cloud chats encrypted with your chat key, a 32-byte key that Tinfoil Chat shows as `key_` followed by two base-36 characters per byte. Its *sync enclave* at `sync.tinfoil.sh` seals and opens them, so Tinfoil's servers store ciphertext only. Workbench reaches the enclave through the Tinfoil SDK's attested client, verified against the `tinfoilsh/confidential-sync` repository like the inference enclave, and sends the key only over that verified channel. Requests carry your Tinfoil sign-in (the website session's identity token), as Tinfoil Chat's own requests do. New chat IDs are made in Workbench in Tinfoil Chat's format, a reverse timestamp and a random UUID, as Tinfoil Chat makes them; no other Tinfoil service is involved.

The protocol follows Tinfoil Chat's open-source web client (`tinfoilsh/tinfoil-webapp`, read, not copied): `/v1/key/current`, `/v1/sync/list-status`, `/v1/sync/pull`, `/v1/sync/push` and `/v1/sync/delete`, and for pictures `/v1/attachment/put` and `/v1/attachment/get`, JSON over POST with protocol version 2. Every stored row has a version, and a write must name the version it was made against.

- **Listing** fetches each changed chat once to read its title. Workbench keeps a listed chat as a title and date until it is opened, so hundreds of cloud chats do not weigh on the workspace.
- **Writing back** pulls the chat, applies Workbench's changes to that copy and pushes it against the version it pulled. Messages that did not change are kept exactly, including every field Workbench does not use (attachments, web search results, timelines). A message whose text was edited keeps its other fields but not its timeline, which would still show the old text. New turns are added as user and assistant messages. Only finished replies are written.
- **Conflicts**: if the chat changed in Tinfoil since Workbench last synced it, the cloud version replaces it in Workbench, and Workbench's version is kept as a local conversation named "… (Workbench copy)". The enclave never merges; neither does Workbench. A newer version that is only the enclave re-sealing an old row is not a conflict.
- **Edit clock**: each write carries Tinfoil's edit clock (a counter and this installation's writer ID), so Tinfoil Chat orders Workbench's writes like its own.
- **Deleted in Tinfoil**: a chat that disappears from the listing leaves Workbench, unless it has changes that were not written yet; then it is kept as a local copy.

**Pictures (1.3).** Tinfoil Chat keeps a cloud chat's pictures apart from its messages, in Tinfoil's attachment storage behind the sync enclave (`/v1/attachment/put` and `/v1/attachment/get`). For each picture the enclave chooses an ID and a key of the picture's own (AES-256), seals the picture with it, and the message keeps the ID, the key, the file name and type and a small thumbnail, never the picture itself. The chat key is not involved: the messages that hold the pictures' keys are sealed with it. Workbench does the same in both directions:

- **Shown** by their thumbnails when a chat is opened. The picture itself is fetched when you continue the chat, because the model gets every picture in the conversation, as in Tinfoil Chat. If that fails, the message is not sent and the reason is shown; a picture that Tinfoil no longer has, or that is not a PNG, JPEG, GIF or WebP, reaches the model as a note.
- **Sent**: a picture attached to a message in a cloud chat, or in a conversation moved to Tinfoil cloud, is stored in Tinfoil's attachment storage before the chat is written. It then takes the ID the enclave gave it, so it is stored once and is not fetched again when the chat is read back. A retried upload uses the same tag and gets the same ID and key back. Tinfoil Chat on other devices shows the picture as its own.
- **Folders** are paths on this computer, for the workspace agent, which cloud chats do not have. A cloud chat refuses a folder, and a conversation with folders attached stays local.

Deleting a cloud chat deletes its pictures in Tinfoil too. A "Workbench copy" of a cloud chat keeps the pictures already fetched; those it never fetched can be fetched only while the cloud chat exists. Chats opened before 1.3 are read again once at the next sync, unless they hold changes not yet written.

**Widgets.** A Tinfoil Chat answer can contain widgets that its model called, kept in the message's timeline between its paragraphs. Workbench draws charts, timelines and stat cards itself, from the widgets' arguments and with the same renderers and checks as its own visual tools, where Tinfoil Chat shows them; they can be expanded, and their data viewed and saved, like Workbench's own. Tinfoil Chat's chart is one series of rows, so it is drawn as one series; a pie of more than six parts is drawn as bars. Other widgets (image, link preview, map, clock, recipe card, message draft, sports scores, artifact preview) load remote content or need Tinfoil's services; the answer's tool runs list them as not displayed. Nothing in a widget is fetched or run, and when you continue the chat the model sees the answer's text, not the widget calls. Chats opened with an earlier version of Workbench are read again once at the next sync, unless they hold changes not yet written.

## What is stored

- The chat key, its key ID and the Tinfoil user it belongs to are kept in the encrypted workspace, like a saved API key. Snapshots, logs and exports never contain the key.
- Cloud chats and projects are kept in the encrypted workspace like local conversations. Exports and imports drop the cloud link, so an import is always a new local conversation.
- Where each picture of a cloud chat is kept (its ID and own key) is in the encrypted workspace, never in snapshots, logs or exports, and is forgotten once no message uses the picture. Fetched pictures are stored like attached ones.
- Tags of cloud chats (Settings → Tags) are kept in the encrypted workspace and in the chat's encrypted plaintext, as `workbenchTags`: `{version: 1, tags: [{id, name, color, style, icon?}], tagged: {at, model?}}`. Tinfoil Chat on the web keeps this field when it edits a chat (its chat schema passes unknown fields through, and its saves copy the whole chat; checked with a test chat renamed on the web) but does not show it, and its backups leave it out. Another Workbench matches each tag by id, then by name ignoring case, and adds a tag its list lacks. A title the classifier writes for a chat that Workbench made is written to the cloud chat like a rename.
- Cloud data belongs to the account whose key was added. If another account signs in, sync stops until that account signs in again or the key is removed.

## Checks

- `tests/cloud.test.mjs`: key parsing (both forms), grouping messages into turns, mapping chats and projects, pictures read by thumbnail and written as Tinfoil Chat keeps them (never folders), picture types from their bytes, write-back fidelity (unchanged chats unchanged, unknown fields kept, edits, new turns, renames, long chats), project context, validation.
- `tests/cloud-sync.test.mjs`: the sync engine against an in-memory enclave with the same version rules and attachment storage (key check, listing and loading, write-back, pictures fetched once and stored once, conflicts before and during a write, re-sealed rows, deletions on both sides, uploads, another account, a changed key, the 300-chat limit, removing the key), the client's wire format, and the key ID against a WebCrypto HKDF derivation.
- `tests/ui-cloud.py`: the Account section, sidebar markers, the loading state and the conversation menu in the production renderer, with synthetic state.
- `tests/cloud-live.mjs` is a manual check with a real account; see its header. It checks, without writing, that writing back ten real chats unchanged would keep their messages exactly and that up to two of their pictures can be fetched, then takes a new test chat, whose first message carries a small generated picture, through upload, rename, a second turn (after dropping the picture's local copy, so it is fetched again) and deletion. It logs statuses and counts only.
