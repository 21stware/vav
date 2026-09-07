# @21stware/vavc

Herdr-style control client for a running [vavd](https://github.com/21stware/vav/tree/main/packages/vavd).

```bash
npx @21stware/vavc status
npx @21stware/vavc session create --cwd .
npx @21stware/vavc agent prompt <id> "hello" --wait
npx @21stware/vavc file list .
npx @21stware/vavc file mkdir ./tmp
npx @21stware/vavc file rename ./a.md ./b.md
npx @21stware/vavc file rm ./b.md
npx @21stware/vavc file reveal ./README.md
npx @21stware/vavc file open ./README.md
npx @21stware/vavc file info ./README.md
npx @21stware/vavc file-session open ./README.md
npx @21stware/vavc file-session create ./README.md
npx @21stware/vavc file-session activate <fileId> <sessionId>
npx @21stware/vavc file-session readonly <sessionId> on
npx @21stware/vavc file-session force-delete <fileId> <sessionId>
npx @21stware/vavc logs stats
npx @21stware/vavc logs record --event cli.note --message "from vavc"
npx @21stware/vavc logs tail --count 1 --event cli.note --message "ping"
npx @21stware/vavc settings secret api --set TOKEN
npx @21stware/vavc settings hint api
npx @21stware/vavc logs export
npx @21stware/vavc logs clear ephemeral
npx @21stware/vavc pane run -- echo hi
npx @21stware/vavc review seed <id>
npx @21stware/vavc review accept-all <setId>
npx @21stware/vavc git status .
npx @21stware/vavc git branch topic --checkout --cwd .
npx @21stware/vavc git checkout main --cwd .
npx @21stware/vavc github pulls .
npx @21stware/vavc github pull 12 --cwd .
npx @21stware/vavc github actions .
npx @21stware/vavc github run 1 --cwd .
npx @21stware/vavc github releases .
npx @21stware/vavc github pages .
npx @21stware/vavc timers list
npx @21stware/vavc timers create
npx @21stware/vavc timers update <id> --title "nightly" --prompt "ping" --enabled off
npx @21stware/vavc timers get <conversationId>
npx @21stware/vavc timers runs
npx @21stware/vavc timers remove <id>
npx @21stware/vavc connectors
npx @21stware/vavc connectors auth
npx @21stware/vavc connectors status cloudflare
npx @21stware/vavc connectors act vercel deploy --cwd .
npx @21stware/vavc connectors login github
npx @21stware/vavc account update <id> --alias "work" --key TOKEN
npx @21stware/vavc account current <id>
npx @21stware/vavc account verify <id>
npx @21stware/vavc account reveal <id>
npx @21stware/vavc account oauth --agent grok
npx @21stware/vavc account cancel --agent grok
```

Pairs with `VAVD_URI`, `~/.vavd`, or loopback `/discover`. Same phone + daemon protocols as VAV desktop, iOS Remote, and the Chrome extension.

Also `npm run vavc` from this repo.
