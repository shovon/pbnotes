# Files

A store for immutable files, kept per device in a folder that a sync tool carries between machines. It is for what an app keeps in such a folder without an event: an image, an attachment.

```
<directory>/
  <device-id>/<folder>/<sha256>.<extension>
  <other-device-id>/<folder>/<sha256>.<extension>
```

```ts
import { find, save } from '@pbnotes/files';

const name = await save(directory, device, 'attachments', bytes, 'pdf');
const file = await find(directory, 'attachments', name); // a path, or undefined
```

## What it guarantees

- A file is named by the SHA-256 of its bytes. The same name in two devices' directories is the same content, so whichever copy has arrived is the right one.
- A file is written under a temporary name and renamed into place. A crash never leaves half a file under a name that claims to be its hash.
- A device writes only inside its own directory, so a sync tool never has two machines on one path.
- A file is looked up in every device's directory. A reference names the file and never the device.

## What it is not for

Anything that changes. Two devices would each hold their own copy with no order between them. Record a change as an event in a ledger instead.

## The layout it shares

The directory can be one that `@pbnotes/append-only-log` keeps a log in. Neither package imports the other; they keep the same layout:

1. A root directory, handed in by the caller.
2. One subdirectory per device. A device writes only inside its own.
3. Inside a device directory, loose files are the ledger's segments. Each subdirectory belongs to whoever claimed its name, and the ledger neither reads nor reports it.

The ledger's spec says the same under "Layout" in `packages/append-only-log/multi-writer.md`. `folder` is the name this store claims.

## The device id

The caller supplies it. This package never mints, stores or changes one. Beside a ledger, pass the id the open log writes as, and ask for it after the log is open: a log can change this machine's id when it opens, and a file has to go under the id it settled on.
