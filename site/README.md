# site

What walkdown.dev serves.

`setup.md` is the bootstrap page, and it is written for an **agent** rather
than a person: the intended use is somebody saying "visit walkdown.dev and set
walkdown up for this project" and their agent doing it. It is deliberately
markdown — an agent fetching a URL gets text reliably and a styled page
unreliably — and it is deliberately short. It gets walkdown onto the machine
and then hands over to the `walkdown-setup` skill, which is the real wizard.

That split is on purpose. The page must work when the machine has nothing, so
it can only assume `git` and `node`; the skill runs after walkdown exists, so
it can use the tool to set the project up. Keeping the procedure in one of them
and the bootstrap in the other is what stops the two drifting into two
different, both-half-right sets of instructions.

The landing page itself is not in this directory yet.
