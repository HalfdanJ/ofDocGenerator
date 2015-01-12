#!/bin/bash

echo "Start ofDoc publishing"
echo $FTP_USER

ncftpput -R -v -u $FTP_USER -p $FTP_PASSWORD 104.130.212.175 / output/*

echo "Publishing done"