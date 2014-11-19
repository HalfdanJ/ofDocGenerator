#!/bin/bash

echo "Start ofDoc publishing"

rm -rf ghpages || exit 0;
git clone --branch=gh-pages https://github.com/HalfdanJ/ofDocGenerator.git ghpages
cp -R output/* ghpages/
(
	cd ghpages;
	git remote set-url origin "https://${GIT_TOKEN}@github.com/HalfdanJ/ofDocGenerator.git";
	git push -fq origin gh-pages
)

echo "Publishing done"