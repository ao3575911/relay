## Summary

## Verification

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test` (30 prototype tests and 93 TypeScript tests; set `RELAY_TEST_DATABASE_URL`)
- [ ] `python3 tests/contracts_checks.py` (19 schema checks)
- [ ] `npm run validate`
- [ ] `npm run build` if prototype sources changed

## Notes

Do not add secrets. The browser prototype is not a security boundary. Do not call live Telegram or OpenAI from CI.
