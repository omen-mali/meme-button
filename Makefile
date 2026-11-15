CLI    := /Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli
FQBN   := arduino:avr:uno
SKETCH := firmware/meme_button
# IDE-bundled libraries (LiquidCrystal); the standalone CLI does not search here
LIBS   := $(HOME)/Library/Arduino15/libraries
PORT   ?= $(firstword $(wildcard /dev/cu.usbmodem* /dev/cu.usbserial*))

.PHONY: compile upload monitor web

compile:
	"$(CLI)" compile --fqbn $(FQBN) --warnings default --libraries "$(LIBS)" $(SKETCH)

upload: compile
	"$(CLI)" upload --fqbn $(FQBN) -p $(PORT) $(SKETCH)

monitor:
	"$(CLI)" monitor -p $(PORT) -c baudrate=115200

web:
	python3 -m http.server 8000 -d web
