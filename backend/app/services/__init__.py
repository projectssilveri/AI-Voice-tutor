"""Business logic.

Route handlers stay thin: they validate input, call into a service, and shape
the response. Anything with a rule in it lives here — most importantly the
certification attempt-limit calculation (build-order step 8), which is
recomputed server-side on every attempt request and never trusted from the
client.
"""
