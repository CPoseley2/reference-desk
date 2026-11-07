#!/bin/zsh
cd -- "${0:A:h}"
exec /usr/bin/python3 -B setup_image_api.py
