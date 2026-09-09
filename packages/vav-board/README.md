# @21stware/vav-board

Herdr-style control client for a running [vav-server](https://github.com/21stware/vav/tree/main/packages/vav-server).

```bash
npx @21stware/vav-board status
npx @21stware/vav-board session create --cwd .
npx @21stware/vav-board agent prompt <id> "hello" --wait
npx @21stware/vav-board file list .
npx @21stware/vav-board file mkdir ./tmp
npx @21stware/vav-board file rename ./a.md ./b.md
npx @21stware/vav-board file rm ./b.md
npx @21stware/vav-board file reveal ./README.md
npx @21stware/vav-board file open ./README.md
npx @21stware/vav-board file info ./README.md
npx @21stware/vav-board file-session open ./README.md
npx @21stware/vav-board file-session create ./README.md
npx @21stware/vav-board file-session activate <fileId> <sessionId>
npx @21stware/vav-board file-session readonly <sessionId> on
npx @21stware/vav-board file-session force-delete <fileId> <sessionId>
npx @21stware/vav-board logs stats
npx @21stware/vav-board logs record --event cli.note --message "from vav-board"
npx @21stware/vav-board logs tail --count 1 --event cli.note --message "ping"
npx @21stware/vav-board settings secret api --set TOKEN
npx @21stware/vav-board settings hint api
npx @21stware/vav-board logs export
npx @21stware/vav-board logs clear ephemeral
npx @21stware/vav-board pane run -- echo hi
npx @21stware/vav-board review seed <id>
npx @21stware/vav-board review accept-all <setId>
npx @21stware/vav-board git status .
npx @21stware/vav-board git branch topic --checkout --cwd .
npx @21stware/vav-board git checkout main --cwd .
npx @21stware/vav-board github pulls .
npx @21stware/vav-board github pull 12 --cwd .
npx @21stware/vav-board github actions .
npx @21stware/vav-board github run 1 --cwd .
npx @21stware/vav-board github releases .
npx @21stware/vav-board github pages .
npx @21stware/vav-board timers list
npx @21stware/vav-board timers create
npx @21stware/vav-board timers update <id> --title "nightly" --prompt "ping" --enabled off
npx @21stware/vav-board timers get <conversationId>
npx @21stware/vav-board timers runs
npx @21stware/vav-board timers remove <id>
npx @21stware/vav-board connectors
npx @21stware/vav-board connectors auth
npx @21stware/vav-board connectors status cloudflare
npx @21stware/vav-board connectors act vercel deploy --cwd .
npx @21stware/vav-board connectors login github
npx @21stware/vav-board account update <id> --alias "work" --key TOKEN
npx @21stware/vav-board account current <id>
npx @21stware/vav-board account verify <id>
npx @21stware/vav-board account reveal <id>
npx @21stware/vav-board account oauth --agent grok
npx @21stware/vav-board account cancel --agent grok
```

Pairs with `VAV_SERVER_URI`, `~/.vav-server`, or loopback `/discover`. Same phone + daemon protocols as VAV desktop, iOS Remote, and the Chrome extension.

Also `npm run vav-board` from this repo.
